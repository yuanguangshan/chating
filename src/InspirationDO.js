/**
 * 灵感 Durable Object (SQLite 后端兼容版)
 * 职责: "创意总监" - 负责聚合、缓存并提供来自全网的创作灵感。
 */
import { DurableObject } from "cloudflare:workers";
import { InspirationService } from './inspirationService.js';

// 定义缓存相关的常量
const CACHE_KEY = 'inspiration_cache_v1';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5分钟缓存有效期

export class InspirationDO extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        this.inspirationService = new InspirationService(env);
        this.initialized = false; // 防止重复初始化数据库表
    }

    /**
     * 初始化数据库，确保缓存表存在
     */
    async initialize() {
        if (this.initialized) return;
        // 使用 SQLite 创建一个简单的键值缓存表
        await this.ctx.db.exec("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT, timestamp INTEGER);");
        this.initialized = true;
        this._log('🗄️ 数据库表初始化完成。');
    }

    _log(message, level = 'INFO', data = null) {
        console.log(`[InspirationDO] [${new Date().toISOString()}] [${level}] ${message}`, data || '');
    }

    /**
     * 核心缓存逻辑：获取或刷新灵感数据 (使用 SQLite)
     * @returns {Promise<Array>} 灵感数据列表
     */
    async getOrFetchInspirations() {
        // 确保数据库表已创建
        await this.initialize();

        // 1. 尝试从 SQLite 缓存读取
        const stmt = this.ctx.db.prepare("SELECT value, timestamp FROM cache WHERE key = ?");
        const cachedRow = await stmt.bind(CACHE_KEY).first();
        
        let cachedData = null;
        if (cachedRow) {
            try {
                cachedData = {
                    data: JSON.parse(cachedRow.value),
                    timestamp: cachedRow.timestamp
                };
            } catch (e) {
                this._log('解析缓存数据失败', 'ERROR', e);
            }
        }

        if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION_MS)) {
            this._log('✅ 从 SQLite 缓存中获取灵感数据。');
            return cachedData.data;
        }

        // 2. 缓存失效或不存在，则重新获取
        this._log('🔄 缓存失效或不存在，正在获取新的灵感数据...');
        try {
            const freshData = await this.inspirationService.getCombinedInspirations();
            
            // 3. 存入 SQLite 缓存 (使用 INSERT OR REPLACE 实现 upsert)
            if (freshData && freshData.length > 0) {
                const insertStmt = this.ctx.db.prepare("INSERT OR REPLACE INTO cache (key, value, timestamp) VALUES (?, ?, ?)");
                await insertStmt.bind(CACHE_KEY, JSON.stringify(freshData), Date.now()).run();
                this._log(`💾 已将 ${freshData.length} 条新灵感数据缓存至 SQLite。`);
            }
            return freshData;
        } catch (error) {
            this._log('❌ 获取新灵感数据失败', 'ERROR', error);
            if (cachedData?.data) {
                this._log('⚠️ 返回旧的 SQLite 缓存数据作为备用。');
                return cachedData.data;
            }
            throw new Error("无法获取灵感数据，且无可用缓存。");
        }
    }

/**
     * 【新增】处理灵感任务并执行回调
     * 这是符合 "委托-回调" 模式的入口方法。
     * @param {object} task - 从 worker 派发过来的完整任务对象
     */
    async processAndCallback(task) {
        const { payload, callbackInfo } = task;
        let finalContent;

        try {
            // 1. 调用现有逻辑获取格式化好的灵感文本
            // 这里的 payload 可以用来传递参数，比如 limit
            finalContent = await this.getInspirationsForChat(payload.limit || 15);
        } catch (error) {
            this._log('在 processAndCallback 中获取灵感失败', 'ERROR', error);
            finalContent = `> (❌ **灵感获取失败**: ${error.message})`;
        }

        // 2. 【关键】执行回调，将结果更新回聊天室
        try {
            if (!this.env.CHAT_ROOM_DO) {
                throw new Error("CHAT_ROOM_DO is not bound. Cannot perform callback.");
            }
            // 根据回调信息，找到原来的聊天室DO
            const chatroomId = this.env.CHAT_ROOM_DO.idFromName(callbackInfo.roomName);
            const chatroomStub = this.env.CHAT_ROOM_DO.get(chatroomId);

            // 调用聊天室DO的简单更新方法
            await chatroomStub.updateMessage(callbackInfo.messageId, finalContent);
            this._log(`✅ 成功回调到房间 ${callbackInfo.roomName} 的消息 ${callbackInfo.messageId}`);

        } catch (callbackError) {
            // 这是一个严重错误，意味着用户看不到最终结果，需要重点监控
            this._log(`FATAL: 回调到房间 ${callbackInfo.roomName} 失败`, 'FATAL', callbackError);
        }
    }

    // RPC 方法 (无需改动)
    async getInspirationsForChat(limit = 15) {
        try {
            const inspirations = await this.getOrFetchInspirations();
            if (!inspirations || inspirations.length === 0) {
                return "😔 抱歉，暂时没有获取到任何创作灵感。";
            }
            let markdown = "🔥 **今日灵感速递 (Top 15)** 🔥\n\n---\n\n";
            inspirations.slice(0, limit).forEach((item, index) => {
                markdown += `${index + 1}. **[${item.source}]** ${item.title}\n`;
                markdown += `   - **分类**: ${item.category}\n`;
                markdown += `   - **热度**: ${item.hotValue}\n`;
                markdown += `   - [查看原文](${item.url})\n\n`;
            });
            return markdown;
        } catch (error) {
            this._log('生成聊天灵感时出错', 'ERROR', error);
            return `💥 获取灵感时发生错误: ${error.message}`;
        }
    }

    // API 接口 (无需改动)
    async fetch(request) {
        const url = new URL(request.url);
        try {
            switch (url.pathname) {
                case '/api/inspirations':
                case '/inspirations':
                    if (request.method === 'GET') {
                        const data = await this.getOrFetchInspirations();
                        return new Response(JSON.stringify({ success: true, count: data.length, data: data }), {
                            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                        });
                    }
                    return new Response('Method Not Allowed', { status: 405 });
                case '/health':
                    return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } });
                default:
                    return new Response('Not Found', { status: 404 });
            }
        } catch (error) {
            this._log(`处理请求 ${url.pathname} 失败`, 'ERROR', error);
            return new Response(JSON.stringify({ success: false, error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
}
