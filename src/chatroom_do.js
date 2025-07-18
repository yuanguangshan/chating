// 文件: src/chatroom_do.js (实现了"白名单即房间授权"的最终版)

import { DurableObject } from "cloudflare:workers";
import { getGeminiChatAnswer, getKimiChatAnswer } from './ai.js';
import { ToutiaoServiceClient } from './toutiaoDO.js';
import ZhihuHotService from './zhihuHotService.js';
const zhihuHotService = new ZhihuHotService();

// 消息类型常量
const MSG_TYPE_CHAT = 'chat';
const MSG_TYPE_GEMINI_CHAT = 'gemini_chat';
const MSG_TYPE_DELETE = 'delete';
const MSG_TYPE_ERROR = 'error';
const MSG_TYPE_WELCOME = 'welcome';
const MSG_TYPE_USER_JOIN = 'user_join';
const MSG_TYPE_USER_LEAVE = 'user_leave';
const MSG_TYPE_DEBUG_LOG = 'debug_log';
const MSG_TYPE_HEARTBEAT = 'heartbeat';
const MSG_TYPE_OFFER = 'offer';
const MSG_TYPE_ANSWER = 'answer';
const MSG_TYPE_CANDIDATE = 'candidate';
const MSG_TYPE_CALL_END = 'call_end';
const MSG_TYPE_USER_LIST_UPDATE = 'user_list_update';

// 【修改】存储键常量
const ALLOWED_USERS_KEY = 'allowed_users';


const JSON_HEADERS = {
    'Content-Type': 'application/json;charset=UTF-8',
    'Access-Control-Allow-Origin': '*'
};






export class HibernatingChating extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        this.messages = null;
        this.sessions = new Map();
        this.debugLogs = [];
        this.maxDebugLogs = 100;
        this.isInitialized = false;
        this.heartbeatInterval = null;
        this.allowedUsers = undefined; // ✨ 初始状态设为undefined，表示"未知"
        
        this.debugLog("🏗️ DO 实例已创建。");
        this.startHeartbeat();
    }

    // ============ 调试日志系统 ============
    debugLog(message, level = 'INFO', data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            id: crypto.randomUUID().substring(0, 8),
            data
        };
        
        this.debugLogs.push(logEntry);
        if (this.debugLogs.length > this.maxDebugLogs) {
            this.debugLogs.shift();
        }
        
        if (data) {
            console.log(`[${timestamp}] [${level}] ${message}`, data);
        } else {
            console.log(`[${timestamp}] [${level}] ${message}`);
        }
        
        if (level !== 'HEARTBEAT') {
            this.broadcastDebugLog(logEntry);
        }
    }

    broadcastDebugLog(logEntry) {
        const message = JSON.stringify({
            type: MSG_TYPE_DEBUG_LOG,
            payload: logEntry
        });
        
        this.sessions.forEach((session) => {
            try {
                if (session.ws.readyState === WebSocket.OPEN) {
                    session.ws.send(message);
                }
            } catch (e) {
                // 静默处理发送失败
            }
        });
    }

    // ============ 状态管理 ============
    async initialize() {
        if (this.isInitialized) return;
        
        // 【修改】只加载白名单，因为其他状态只在会话中才需要
        const allowed = await this.ctx.storage.get(ALLOWED_USERS_KEY);

        // 【✨ 核心逻辑 ✨】
        // 如果存储中从未设置过这个key，`get`会返回undefined。
        // 我们用 `null` 来表示一个"已激活但为空"的白名单，
        // 而 `undefined` 表示"从未被管理员触碰过"的状态。
        if (allowed === undefined) {
            this.allowedUsers = undefined; // 白名单功能未对本房间激活
            this.debugLog(`ℹ️ 房间白名单未激活。此房间不允许访问。`);
        } else {
            this.allowedUsers = new Set(allowed || []); // 已激活，加载用户列表
            this.debugLog(`📁 已加载白名单. Allowed Users: ${this.allowedUsers.size}`);
        }
        
        // 只有在实际需要时才加载消息历史
        this.messages = null; 
        
        this.isInitialized = true;
    }

    async saveState() {
        if (this.allowedUsers === undefined) {
            // 如果白名单从未被激活过，我们甚至不创建这个存储键
            return;
        }

        const savePromise = this.ctx.storage.put(ALLOWED_USERS_KEY, Array.from(this.allowedUsers));
        
        this.ctx.waitUntil(savePromise);
        try {
            await savePromise;
            this.debugLog(`💾 白名单状态已保存. Allowed: ${this.allowedUsers.size}`);
        } catch (e) {
            this.debugLog(`💥 白名单状态保存失败: ${e.message}`, 'ERROR');
        }
    }

    // --- 【新增】加载消息历史的独立函数 ---
    async loadMessages() {
        if (this.messages === null) {
            this.messages = (await this.ctx.storage.get("messages")) || [];
            this.debugLog(`📨 消息历史已加载: ${this.messages.length}条`);
        }
    }
    
    // --- 【新增】保存消息历史的独立函数 ---
    async saveMessages() {
        if (this.messages === null) return;
        const savePromise = this.ctx.storage.put("messages", this.messages);
        this.ctx.waitUntil(savePromise);
        try {
            await savePromise;
            this.debugLog(`💾 消息历史已保存: ${this.messages.length}条`);
        } catch (e) {
            this.debugLog(`💥 消息历史保存失败: ${e.message}`, 'ERROR');
        }
    }



    // ============ 心跳机制 ============
    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, 30000);
    }

    sendHeartbeat() {
        if (this.sessions.size === 0) return;

        const heartbeatMessage = JSON.stringify({
            type: MSG_TYPE_HEARTBEAT,
            payload: { timestamp: Date.now() }
        });

        const now = Date.now();
        const timeout = 120000; // 120秒超时 (增加容错时间)
        let activeSessions = 0;
        const disconnectedSessions = [];

        this.sessions.forEach((session, sessionId) => {
            // 检查会话是否超时
            if (now - session.lastSeen > timeout) {
                this.debugLog(`💔 会话超时: 👦 ${session.username} (超过 ${timeout / 1000}s 未响应)`, 'WARN');
                disconnectedSessions.push(sessionId);
                return; // 跳过后续处理
            }

            try {
                if (session.ws.readyState === WebSocket.OPEN) {
                    session.ws.send(heartbeatMessage);
                    activeSessions++;
                } else if (session.ws.readyState !== WebSocket.CONNECTING) {
                    // 如果连接不是OPEN也不是CONNECTING，则视为断开
                    disconnectedSessions.push(sessionId);
                }
            } catch (e) {
                this.debugLog(`💥 发送心跳失败: 👦 ${session.username}`, 'ERROR', e);
                disconnectedSessions.push(sessionId);
            }
        });

        // 统一清理断开的会话
        if (disconnectedSessions.length > 0) {
            disconnectedSessions.forEach(sessionId => {
                this.cleanupSession(sessionId, { code: 1011, reason: 'Heartbeat/Timeout failed', wasClean: false });
            });
        }

        if (activeSessions > 0) {
            this.debugLog(`💓 发送心跳包到 ${activeSessions} 个活跃会话 🟢 `, 'HEARTBEAT');
        }
    }

    // ============ RPC 方法 ============
    async postBotMessage(payload, secret) {
        if (this.env.CRON_SECRET && secret !== this.env.CRON_SECRET) {
            this.debugLog("机器人发帖：未授权的尝试！", 'ERROR');
            return;
        }
        
        this.debugLog(`🤖 机器人自动发帖...`, 'INFO', payload);
        await this.initialize();
        
        if (this.allowedUsers === undefined) {
            this.debugLog(`🚫 拒绝机器人发帖: 房间未经授权 (白名单未激活)`, 'WARN');
            return;
        }
        
        await this.loadMessages();
        
        const message = {
            id: crypto.randomUUID(),
            username: "机器人小助手", 
            timestamp: Date.now(),
            ...payload 
        };
        
        await this.addAndBroadcastMessage(message);
    }

    async cronPost(text, secret) {
        this.debugLog(`🤖 收到定时任务, 自动发送文本消息: ${text}`);
        await this.postBotMessage({ text, type: 'text' }, secret);
    }

    // 【新增】RPC方法，用于从外部（如worker）记录日志
    async logAndBroadcast(message, level = 'INFO', data = null) {
        // 确保DO已初始化，以便可以访问到会话
        await this.initialize();
        this.debugLog(message, level, data);
    }

    // 【新增】RPC方法，用于从外部（如worker）广播系统消息
    async broadcastSystemMessage(payload, secret) {
        if (this.env.CRON_SECRET && secret !== this.env.CRON_SECRET) {
            this.debugLog("系统消息：未授权的尝试！", 'ERROR');
            return;
        }
        await this.initialize();
        this.debugLog(`📢 收到系统消息: ${payload.message}`, payload.level || 'INFO', payload.data);
        this.broadcast({ type: MSG_TYPE_DEBUG_LOG, payload: { message: payload.message, level: payload.level, data: payload.data, timestamp: new Date().toISOString(), id: crypto.randomUUID().substring(0, 8) } });
    }

    async handleToutiaoTask(session, payload) {
        const originalMessage = {
            id: payload.id || crypto.randomUUID(),
            username: session.username,
            timestamp: payload.timestamp || Date.now(),
            text: payload.text.trim(),
            type: 'text'
        };

        // 1. 立即发送一个"正在处理"的消息给前端
        const thinkingMessage = {
            ...originalMessage,
            text: `${originalMessage.text}\n\n> (✍️ 正在生成头条内容...)`
        };
        await this.addAndBroadcastMessage(thinkingMessage);

        // 2. 使用 waitUntil 在后台执行整个生成和发布流程
        this.ctx.waitUntil((async () => {
            try {
                // 创建头条服务客户端
                const toutiaoClient = new ToutiaoServiceClient(this.env);
                
                // 提交任务到头条服务并立即处理
                const task = {
                    text: originalMessage.text,
                    username: session.username,
                    id: `toutiao_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                };
                const result = await toutiaoClient.processTask(task);

                // 构建最终消息内容
                let finalMessage;
                if (result.success) {
                    let displayContent = result.content;
                    const maxLength = parseInt(this.env.MAX_CONTENT_LENGTH) || 10000;
                    if (displayContent.length > maxLength) {
                        displayContent = displayContent.substring(0, maxLength) + '...\n\n*(内容过长，已截断显示)*';
                    }
                    
                    finalMessage = `${originalMessage.text}

> ✅ **头条内容已生成并发布到头条**
> **标题**: ${result.title}
> **发布时间**: ${new Date().toLocaleString('zh-CN')}
> **处理耗时**: ${result.processingTime}ms

---
### 📋 完整内容
${displayContent}`;
                } else {
                    finalMessage = `${originalMessage.text}

> ❌ **头条内容生成失败**: ${result.error}`;
                }

                // 更新聊天室消息为最终状态
                const messageIndex = this.messages.findIndex(m => m.id === thinkingMessage.id);
                if (messageIndex !== -1) {
                    this.messages[messageIndex].text = finalMessage;
                    this.messages[messageIndex].timestamp = Date.now();
                    await this.saveMessages();
                    this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
                }

            } catch (error) {
                // 处理失败状态
                const messageIndex = this.messages.findIndex(m => m.id === thinkingMessage.id);
                if (messageIndex !== -1) {
                    this.messages[messageIndex].text += `\n\n> (❌ **操作失败**: ${error.message})`;
                    await this.saveMessages();
                    this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
                }
            }
        })());
    }

    /**
     * 处理知乎热点任务
     * @param {Object} session 用户会话
     * @param {Object} payload 消息载荷
     */
    async handleZhihuHotTask(session, payload) {
        const originalMessage = {
            id: payload.id || crypto.randomUUID(),
            username: session.username,
            timestamp: payload.timestamp || Date.now(),
            text: payload.text.trim(),
            type: 'text'
        };

        // 1. 立即发送一个"正在处理"的消息给前端
        const thinkingMessage = {
            ...originalMessage,
            text: `${originalMessage.text}\n\n> (🔍 正在获取知乎热点...)`
        };
        await this.addAndBroadcastMessage(thinkingMessage);

        // 2. 使用 waitUntil 在后台执行获取和生成流程
        this.ctx.waitUntil((async () => {
            try {
                // 获取知乎热点话题
                const topics = await zhihuHotService.getHotTopicsForContent(5);
                
                if (!topics || topics.length === 0) {
                    throw new Error('未能获取到知乎热点话题');
                }

                // 构建回复消息
                let responseText = "🔥 **知乎实时热点话题**\n\n";
                
                topics.forEach((topic, index) => {
                    responseText += `${index + 1}. **${topic.title}**\n`;
                    responseText += `   🔥 热度: ${topic.hotValue}\n`;
                    responseText += `   💡 创作提示: ${topic.excerpt.substring(0, 50)}...\n`;
                    responseText += `   📝 标签: ${topic.tags.join(', ')}\n\n`;
                });

                responseText += "💡 **使用说明**:\n";
                responseText += "- 发送 `/知乎文章 1` 可基于第1个话题生成完整文章\n";
                responseText += "- 发送 `/知乎话题 [关键词]` 可搜索相关话题\n";
                responseText += "- 点击话题标题可查看原知乎问题";

                // 更新聊天室消息为最终状态
                const messageIndex = this.messages.findIndex(m => m.id === thinkingMessage.id);
                if (messageIndex !== -1) {
                    this.messages[messageIndex].text = responseText;
                    this.messages[messageIndex].timestamp = Date.now();
                    this.messages[messageIndex].topics = topics; // 存储话题数据供后续使用
                    await this.saveMessages();
                    this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
                }

            } catch (error) {
                // 处理失败状态
                const messageIndex = this.messages.findIndex(m => m.id === thinkingMessage.id);
                if (messageIndex !== -1) {
                    this.messages[messageIndex].text = `${originalMessage.text}\n\n> (❌ **获取失败**: ${error.message})`;
                    await this.saveMessages();
                    this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
                }
            }
        })());
    }

    /**
     * 基于知乎热点生成文章
     * @param {Object} session 用户会话
     * @param {string} topicInfo 话题信息（索引或关键词）
     */
    async generateZhihuArticle(session, topicInfo) {
        const taskId = crypto.randomUUID();
        
        // 1. 立即发送处理状态
        const processingMessage = {
            id: taskId,
            username: session.username,
            timestamp: Date.now(),
            text: `📝 正在基于知乎热点生成文章...\n\n> (⏳ 正在处理 ${topicInfo} 话题...)`,
            type: 'text'
        };
        await this.addAndBroadcastMessage(processingMessage);

        // 2. 后台生成文章
        this.ctx.waitUntil((async () => {
            try {
                // 获取最新热点话题
                const topics = await zhihuHotService.getHotTopicsForContent(10);
                let selectedTopic;

                if (/^\d+$/.test(topicInfo)) {
                    // 按索引选择话题
                    const index = parseInt(topicInfo) - 1;
                    if (index >= 0 && index < topics.length) {
                        selectedTopic = topics[index];
                    } else {
                        throw new Error(`话题索引 ${topicInfo} 无效，请使用 1-${topics.length} 之间的数字`);
                    }
                } else {
                    // 按关键词搜索话题
                    const keyword = topicInfo.toLowerCase();
                    selectedTopic = topics.find(topic => 
                        topic.title.toLowerCase().includes(keyword) || 
                        topic.tags.some(tag => tag.toLowerCase().includes(keyword))
                    );
                    
                    if (!selectedTopic) {
                        throw new Error(`未找到包含关键词 "${topicInfo}" 的话题`);
                    }
                }

                // 使用头条服务生成文章
                const toutiaoClient = new ToutiaoServiceClient(this.env);
                const task = {
                    text: selectedTopic.contentPrompt,
                    username: session?.username || 'system',
                    timestamp: Date.now(),
                    id: `zhihu_article_${Date.now()}`
                };

                const result = await toutiaoClient.processTask(task);
                
                // 构建包含知乎话题信息的文章
                const articleMessage = {
                    id: `zhihu_article_${Date.now()}`,
                    username: '知乎文章助手',
                    text: `🎯 **基于知乎热点生成的文章**\n\n**话题**: ${selectedTopic.title}\n**热度**: ${selectedTopic.hotValue}\n**标签**: ${selectedTopic.tags.join(', ')}\n\n---\n\n**标题**: ${result.title}\n\n**正文**: ${result.content}\n\n🔗 **原文链接**: ${selectedTopic.url}\n\n💡 如有不同观点，欢迎留言交流！`,
                    timestamp: Date.now(),
                    type: 'system'
                };

                // 替换处理消息为最终结果
                const messageIndex = this.messages.findIndex(m => m.id === processingMessage.id);
                if (messageIndex !== -1) {
                    this.messages[messageIndex] = articleMessage;
                    await this.saveMessages();
                    this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
                } else {
                    await this.addAndBroadcastMessage(articleMessage);
                }

            } catch (error) {
                const errorMessage = {
                    id: `zhihu_article_error_${Date.now()}`,
                    username: '系统消息',
                    text: `❌ 知乎文章生成失败\n\n**错误**: ${error.message}\n\n请检查话题索引或关键词后重试。`,
                    timestamp: Date.now(),
                    type: 'system'
                };
                
                const messageIndex = this.messages.findIndex(m => m.id === processingMessage.id);
                if (messageIndex !== -1) {
                    this.messages[messageIndex] = errorMessage;
                    await this.saveMessages();
                    this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
                } else {
                    await this.addAndBroadcastMessage(errorMessage);
                }
            }
        })());
    }

    /**
     * 基于知乎热点生成相关话题
     * @param {Object} session 用户会话
     * @param {string} keyword 话题关键词
     */
    async handleZhihuTopicGeneration(session, keyword) {
        const taskId = crypto.randomUUID();
        
        // 1. 立即发送处理状态
        const processingMessage = {
            id: taskId,
            username: session.username,
            timestamp: Date.now(),
            text: `🎯 正在基于"${keyword}"生成相关话题...

> (⏳ 正在调用Gemini AI生成创意话题...)`,
            type: 'text'
        };
        await this.addAndBroadcastMessage(processingMessage);

        // 2. 后台生成相关话题
        this.ctx.waitUntil((async () => {
            try {
                // 调用知乎服务生成相关话题
                const relatedTopics = await zhihuHotService.generateRelatedTopics(keyword, 15);
                
                if (relatedTopics && relatedTopics.length > 0) {
                    let response = `🎯 **基于"${keyword}"生成的相关话题**\n\n`;
                    
                    relatedTopics.forEach((topic, index) => {
                        response += `${index + 1}. **${topic.title}**\n`;
                        response += `   ${topic.excerpt}\n`;
                        response += `   🏷️ 标签: ${topic.tags.join(' ')}\n\n`;
                    });
                    
                    response += `💡 **使用建议**：\n`;
                    response += `- 输入 /知乎文章 ${keyword} 生成相关文章\n`;
                    response += `- 输入 /知乎话题 [新关键词] 探索更多话题\n`;
                    response += `- 输入 /知乎 查看当前热点榜单`;
                    
                    const resultMessage = {
                        id: `zhihu_topics_${Date.now()}`,
                        username: '知乎话题助手',
                        text: response,
                        timestamp: Date.now(),
                        type: 'system'
                    };

                    // 替换处理消息为最终结果
                    const messageIndex = this.messages.findIndex(m => m.id === processingMessage.id);
                    if (messageIndex !== -1) {
                        this.messages[messageIndex] = resultMessage;
                        await this.saveMessages();
                        this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
                    } else {
                        await this.addAndBroadcastMessage(resultMessage);
                    }
                } else {
                    throw new Error('未能生成相关话题，请尝试其他关键词');
                }

            } catch (error) {
                const errorMessage = {
                    id: `zhihu_topics_error_${Date.now()}`,
                    username: '系统消息',
                    text: `❌ 话题生成失败

**错误**: ${error.message}

请稍后重试或尝试其他关键词。`,
                    timestamp: Date.now(),
                    type: 'system'
                };
                
                const messageIndex = this.messages.findIndex(m => m.id === processingMessage.id);
                if (messageIndex !== -1) {
                    this.messages[messageIndex] = errorMessage;
                    await this.saveMessages();
                    this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
                } else {
                    await this.addAndBroadcastMessage(errorMessage);
                }
            }
        })());
    }

// 在 HibernatingChating 类内部，例如放在 handleToutiaoTask 函数后面

    /**
     * [安全网机制] 由 Cron 定时任务触发，处理可能积压的头条任务队列。
     * 在正常情况下（即时处理成功），这个队列应该是空的。
     * @param {string} secret - 用于验证请求来源的密钥
     */
    async processToutiaoQueue(secret) {
        // 安全验证和环境检查
        if (!secret || secret !== this.env.CRON_SECRET) {
            this.debugLog('🚫 processToutiaoQueue 收到无效的 secret，拒绝执行。', 'WARN');
            return { success: false, error: '无效的密钥' };
        }

        if (!this.env.TOUTIAO_SERVICE_DO) {
            this.debugLog('❌ 头条服务未配置，跳过队列处理', 'ERROR');
            return { success: false, error: '头条服务未配置' };
        }

        this.debugLog('⏰ Cron 触发的安全网机制启动，委托头条服务处理积压任务...', 'INFO');

        try {
            // 创建头条服务客户端
            const toutiaoClient = new ToutiaoServiceClient(this.env);
            
            // 委托头条服务处理队列
            const result = await toutiaoClient.processQueue();
            
            this.debugLog(`🎉 头条服务处理完成: ${result?.processedCount || 0} 个任务已处理`, 'INFO');
            
            return { 
                success: true, 
                processedCount: result?.processedCount || 0,
                message: `成功处理 ${result?.processedCount || 0} 个任务`
            };
            
        } catch (error) {
            this.debugLog(`❌ 委托头条服务处理队列时失败: ${error.message}`, 'ERROR', error);
            return { 
                success: false, 
                error: error.message,
                message: '处理队列时发生错误'
            };
        }
    }
    // ============ 主要入口点 ============
    async fetch(request) {
        const url = new URL(request.url);
        this.debugLog(`🚘 服务端入站请求: ${request.method} ${url.pathname}`);

        await this.initialize();

        if (request.headers.get("Upgrade") === "websocket") {
            return await this.handleWebSocketUpgrade(request, url);
        }
        
        if (url.pathname.startsWith('/api/')) {
            return await this.handleApiRequest(request);
        }

        if (request.method === "GET") {
            this.debugLog(`📄 发送HTML文件: ${url.pathname}`);
            return new Response(null, {
                headers: { "X-DO-Request-HTML": "true" },
            });
        }

        this.debugLog(`❓ 未处理连接🔗: ${request.method} ${url.pathname}`, 'WARN');
        return new Response("API endpoint not found", { status: 404 });
    }


async handleWebSocketUpgrade(request, url) {
    // 这部分保持不变，总是先升级连接
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.handleSessionInitialization(server, url); // 将 server 和 url 传递给后台处理
    return new Response(null, { status: 101, webSocket: client });
}

// --- 【修改】独立的会话初始化处理函数 (带延迟关闭) ---
async handleSessionInitialization(ws, url) {
    const username = decodeURIComponent(url.searchParams.get("username") || "Anonymous");

    // 确保DO状态已初始化
    await this.initialize();
    
    let reason = null;

    // 权限检查
    if (this.allowedUsers === undefined) {
        reason = "房间不存在或未激活，请联系管理员开放此房间。";
        this.debugLog(`🚫 授权失败: 房间未经授权。用户: ${username}`, 'WARN');
    } else if (!this.allowedUsers.has(username)) {
        reason = "您不在本房间的白名单中，无法加入。";
        this.debugLog(`🚫 授权失败: 用户不在白名单中。用户: ${username}`, 'WARN');
    }

    // 如果存在拒绝原因 (即权限检查失败)
    if (reason) {
        try {
            // 1. 立即发送自定义的失败消息，让用户马上看到提示
            ws.send(JSON.stringify({
                type: 'auth_failed',
                payload: {
                    message: reason,
                    contact: "yuangunangshan@gmail.com"
                }
            }));

            // 2. 【核心修改】设置一个10秒的定时器来关闭连接
            this.ctx.waitUntil(new Promise(resolve => {
                setTimeout(() => {
                    try {
                        // 10秒后，如果连接还开着，就用 1008 关闭它
                        if (ws.readyState === WebSocket.OPEN) {
                            this.debugLog(`⏰ 定时器触发，关闭无权限用户的连接: ${username}`);
                            ws.close(1008, reason);
                        }
                    } catch (e) {
                        // ignore
                    }
                    resolve();
                }, 1000); // 10秒延迟
            }));

        } catch(e) {
            this.debugLog(`💥 发送授权失败消息到用户 ${username} 失败: ${e.message}`, 'ERROR', e);
            // 如果在发送消息时就出错了，直接关闭
            ws.close(1011, "授权检查期间发生内部服务器错误。");
        }
        return; // 结束处理，不进入正常会话
    }

    // --- 如果所有检查都通过，则继续处理正常会话 ---
    this.debugLog(`✅ 授权用户连接: ${username}`);
    await this.handleWebSocketSession(ws, url, username);
}

    // ============ API 请求处理 ============
    async handleApiRequest(request) {
        const url = new URL(request.url);
        
        // 定义API路由映射
        const apiRoutes = new Map([
            ['/users/list', this.handleListUsers.bind(this)],
            ['/users/add', this.handleAddUser.bind(this)],
            ['/users/remove', this.handleRemoveUser.bind(this)],
            ['/users/clear', this.handleClearUsers.bind(this)],
            ['/messages/history', this.handleMessageHistory.bind(this)],
            ['/messages/delete', this.handleDeleteMessage.bind(this)],
            ['/room/status', this.handleRoomStatus.bind(this)],
            ['/debug/logs', this.handleDebugLogs.bind(this)],
            ['/debug/sessions', this.handleDebugSessions.bind(this)],
            ['/debug/clear', this.handleClearDebugLogs.bind(this)],
            ['/reset-room', this.handleResetRoom.bind(this)]
        ]);
        
        // 查找匹配的路由处理器
        for (const [path, handler] of apiRoutes) {
            if (url.pathname.endsWith(path)) {
                return await handler(request, url);
            }
        }
        
        this.debugLog(`❓ 未找到API路由: ${url.pathname}`, 'WARN');
        return new Response("未找到API端点", { status: 404 });
    }
    
    // 用户列表API处理器
    async handleListUsers(request) {
        if (this.allowedUsers === undefined) {
            return new Response(JSON.stringify({
                users: [],
                count: 0,
                active: false
            }), { headers: JSON_HEADERS });
        }
        
        return new Response(JSON.stringify({
            users: Array.from(this.allowedUsers),
            count: this.allowedUsers.size,
            active: true
        }), { headers: JSON_HEADERS });
    }
        
    // 添加用户API处理器
    async handleAddUser(request, url) {
        if (request.method !== 'POST') {
            return new Response('方法不允许', { status: 405 });
        }
        
        const secret = url.searchParams.get('secret');
        if (this.env.ADMIN_SECRET && secret !== this.env.ADMIN_SECRET) {
            this.debugLog("🚫 未授权的用户添加尝试", 'WARN');
            return new Response("禁止访问。", { status: 403 });
        }
        
        try {
            const { username } = await request.json();
            if (username && username.trim()) {
                const cleanUsername = username.trim();
                
                // 首次添加用户时激活白名单
                if (this.allowedUsers === undefined) {
                    this.allowedUsers = new Set();
                    this.debugLog(`✨ 房间白名单已激活！`, 'INFO');
                }
                
                this.allowedUsers.add(cleanUsername);
                await this.saveState();
                this.debugLog(`✅ 用户 ${cleanUsername} 已添加到白名单`);
                return new Response(JSON.stringify({ 
                    success: true, 
                    user: cleanUsername, 
                    action: 'added',
                    totalUsers: this.allowedUsers.size,
                    active: true
                }), { headers: JSON_HEADERS });
            }
            this.debugLog(`❌ 添加用户失败: 缺少或空用户名`, 'WARN');
            return new Response('缺少或空的用户名', { status: 400 });
        } catch (e) {
            this.debugLog(`❌ 添加用户失败: 无效JSON: ${e.message}`, 'ERROR', e);
            return new Response('无效的JSON', { status: 400 });
        }
    }
        
    // 移除用户API处理器
    async handleRemoveUser(request, url) {
        if (request.method !== 'POST') {
            return new Response('方法不允许', { status: 405 });
        }
        
        const secret = url.searchParams.get('secret');
        if (this.env.ADMIN_SECRET && secret !== this.env.ADMIN_SECRET) {
            this.debugLog("🚫 未授权的用户移除尝试", 'WARN');
            return new Response("禁止访问。", { status: 403 });
        }
        
        try {
            const { username } = await request.json();
            if (username && username.trim()) {
                if (this.allowedUsers === undefined) {
                    return new Response('此房间的白名单未激活', { status: 404 });
                }
                
                const cleanUsername = username.trim();
                const deleted = this.allowedUsers.delete(cleanUsername);
                if (deleted) {
                    await this.saveState();
                    this.debugLog(`🗑️ 用户 ${cleanUsername} 已从白名单移除`);
                    
                    // 断开该用户的现有连接
                    this.sessions.forEach((session, sessionId) => {
                        if (session.username === cleanUsername) {
                            this.debugLog(`⚡ 断开已移除用户的连接: ${cleanUsername}`);
                            session.ws.close(1008, "User removed from allowed list");
                        }
                    });
                    
                    return new Response(JSON.stringify({ 
                        success: true, 
                        user: cleanUsername, 
                        action: 'removed',
                        totalUsers: this.allowedUsers.size
                    }), { headers: JSON_HEADERS });
                } else {
                    this.debugLog(`❌ 移除用户失败: 用户 ${cleanUsername} 不在白名单中`, 'WARN');
                    return new Response('在允许列表中未找到用户', { status: 404 });
                }
            }
            this.debugLog(`❌ 移除用户失败: 缺少或空用户名`, 'WARN');
            return new Response('缺少或空的用户名', { status: 400 });
        } catch (e) {
            this.debugLog(`❌ 移除用户失败: 无效JSON: ${e.message}`, 'ERROR', e);
            return new Response('无效的JSON', { status: 400 });
        }
    }
        
    // 清空白名单API处理器
    async handleClearUsers(request, url) {
        if (request.method !== 'POST') {
            return new Response('方法不允许', { status: 405 });
        }
        
        const secret = url.searchParams.get('secret');
        if (this.env.ADMIN_SECRET && secret !== this.env.ADMIN_SECRET) {
            this.debugLog("🚫 未授权的清空用户尝试", 'WARN');
            return new Response("禁止访问。", { status: 403 });
        }
        
        if (this.allowedUsers === undefined) {
            this.debugLog(`❌ 清空白名单失败: 白名单未激活`, 'WARN');
            return new Response('此房间的白名单未激活', { status: 404 });
        }
        
        const previousCount = this.allowedUsers.size;
        this.allowedUsers.clear();
        await this.saveState();
        this.debugLog(`🧹 白名单已清空，移除了 ${previousCount} 个用户`);
        
        return new Response(JSON.stringify({ 
            success: true, 
            cleared: previousCount,
            totalUsers: 0
        }), { headers: JSON_HEADERS });
    };
        
    // 消息历史API处理器 (支持分页)
    async handleMessageHistory(request, url) {
        if (this.allowedUsers === undefined) {
            return new Response('房间未找到或未激活', { status: 404 });
        }

        await this.loadMessages();

        const beforeId = url.searchParams.get('beforeId');
        const limit = 20;

        let endIndex = this.messages.length;
        if (beforeId) {
            const index = this.messages.findIndex(m => m.id === beforeId);
            if (index !== -1) {
                endIndex = index;
            }
        }

        const startIndex = Math.max(0, endIndex - limit);
        const historySlice = this.messages.slice(startIndex, endIndex);
        const hasMore = startIndex > 0;

        this.debugLog(`📜 请求历史消息. beforeId: ${beforeId}, 返回: ${historySlice.length} 条, 更多: ${hasMore}`);

        return new Response(JSON.stringify({
            messages: historySlice,
            hasMore: hasMore
        }), { headers: JSON_HEADERS });
    }

    // 消息删除API处理器
    async handleDeleteMessage(request, url) {
        const messageId = url.searchParams.get('id');
        const secret = url.searchParams.get('secret');
        
        if (this.allowedUsers === undefined) {
            return new Response('房间未找到或未激活', { status: 404 });
        }
        
        if (this.env.ADMIN_SECRET && secret === this.env.ADMIN_SECRET) {
            await this.loadMessages();
            
            const originalCount = this.messages.length;
            this.messages = this.messages.filter(msg => msg.id !== messageId);
            const deleted = originalCount - this.messages.length;
            
            if (deleted > 0) {
                await this.saveMessages();
                this.debugLog(`🗑️ 消息已删除: ${messageId}`);
                this.broadcast({ type: MSG_TYPE_DELETE, payload: { messageId } });
                return new Response(JSON.stringify({
                    message: "消息删除成功",
                    deleted: deleted
                }), { headers: JSON_HEADERS });
            } else {
                return new Response(JSON.stringify({
                    message: "未找到消息"
                }), { status: 404, headers: JSON_HEADERS });
            }
        } else {
            this.debugLog("🚫 未授权的删除尝试", 'WARN');
            return new Response("禁止访问。", { status: 403 });
        }
    }

    // 房间状态API处理器
    async handleRoomStatus(request) {
        let status = {
            allowedUsers: this.allowedUsers === undefined ? 0 : this.allowedUsers.size,
            activeSessions: this.sessions.size,
            isInitialized: this.isInitialized,
            active: this.allowedUsers !== undefined,
            timestamp: new Date().toISOString()
        };
        
        if (this.allowedUsers !== undefined) {
            if (this.messages === null) {
                const messageCount = (await this.ctx.storage.get("messages_count")) || 0;
                status.totalMessages = messageCount;
            } else {
                status.totalMessages = this.messages.length;
                status.lastActivity = this.messages.length > 0 ? 
                    Math.max(...this.messages.map(m => m.timestamp)) : null;
            }
        }
        
        return new Response(JSON.stringify(status), { headers: JSON_HEADERS });
    }

    // 调试日志API处理器
    async handleDebugLogs(request) {
        this.debugLog(`🔍 请求debug信息. Total logs: ${this.debugLogs.length}`);
        return new Response(JSON.stringify({
            logs: this.debugLogs,
            totalLogs: this.debugLogs.length,
            activeSessions: this.sessions.size,
            allowedUsers: this.allowedUsers === undefined ? 0 : this.allowedUsers.size,
            active: this.allowedUsers !== undefined,
            timestamp: new Date().toISOString()
        }), { headers: JSON_HEADERS });
    }
        
    // 调试会话API处理器
    async handleDebugSessions(request) {
        const sessionInfo = this.getActiveUserList(true);
        return new Response(JSON.stringify({
            sessions: sessionInfo,
            totalSessions: this.sessions.size,
            timestamp: new Date().toISOString()
        }), { headers: JSON_HEADERS });
    }
        
    // 清除调试日志API处理器
    async handleClearDebugLogs(request) {
        const clearedCount = this.debugLogs.length;
        this.debugLogs = [];
        this.debugLog(`🧹 Debug logs cleared. Cleared ${clearedCount} logs`);
        return new Response(JSON.stringify({
            message: `Cleared ${clearedCount} debug logs`,
            timestamp: new Date().toISOString()
        }), { headers: JSON_HEADERS });
    }
        
    // 房间重置API处理器
    async handleResetRoom(request, url) {
        const secret = url.searchParams.get('secret');
        if (this.env.ADMIN_SECRET && secret === this.env.ADMIN_SECRET) {
            await this.ctx.storage.deleteAll();
            this.messages = [];
            this.sessions.clear();
            this.debugLogs = [];
            this.allowedUsers = undefined;
            this.debugLog("🔄 房间已成功重置");
            this.broadcastUserListUpdate();
            return new Response("房间已成功重置。", { status: 200 });
        } else {
            this.debugLog("🚫 未授权的重置尝试", 'WARN');
            return new Response("错了噢~,请输入正确的密码.", { status: 403 });
        }
    }


    // ============ 辅助方法 ============
    getActiveUserList(detailed = false) {
        if (detailed) {
            return Array.from(this.sessions.values()).map(session => ({
                id: session.id,
                username: session.username,
                joinTime: session.joinTime,
                lastSeen: session.lastSeen,
                isConnected: session.ws.readyState === WebSocket.OPEN
            }));
        } else {
            return Array.from(this.sessions.values()).map(session => ({
                id: session.id,
                username: session.username
            }));
        }
    }

    broadcastUserListUpdate() {
        const users = this.getActiveUserList();
        this.broadcast({
            type: MSG_TYPE_USER_LIST_UPDATE,
            payload: {
                users: users,
                userCount: users.length
            }
        });
        this.debugLog(`📡 已广播最新在线用户列表，当前 ${users.length} 位在线用户。`);
    }

    forwardRtcSignal(type, fromSession, payload) {
        if (!payload.target) {
            this.debugLog(`❌ RTC signal of type "${type}" is missing a target.`, 'WARN', payload);
            return;
        }

        let targetSession = null;
        for (const session of this.sessions.values()) {
            if (session.username === payload.target) {
                targetSession = session;
                break;
            }
        }
        
        if (targetSession && targetSession.ws.readyState === WebSocket.OPEN) {
            this.debugLog(`➡️ Forwarding RTC signal "${type}" from ${fromSession.username} to ${payload.target}`);
            
            const messageToSend = {
                type: type,
                payload: {
                    ...payload,
                    from: fromSession.username
                }
            };

            try {
                targetSession.ws.send(JSON.stringify(messageToSend));
            } catch (e) {
                this.debugLog(`💥 Failed to forward RTC signal to ${payload.target}: ${e.message}`, 'ERROR');
            }
        } else {
            this.debugLog(`⚠️ Target user "${payload.target}" for RTC signal not found or not connected.`, 'WARN');
        }
    }

    // ============ WebSocket 会话处理 ============
    async handleWebSocketSession(ws, url, username) {
        const sessionId = crypto.randomUUID();
        const now = Date.now();
        
        const session = {
            id: sessionId,
            username,
            ws,
            joinTime: now,
            lastSeen: now
        };
        
        this.sessions.set(sessionId, session);
        ws.sessionId = sessionId;

        this.debugLog(`✅ 接受用户连接: 👦 ${username} (Session: ${sessionId}). Total sessions: ${this.sessions.size}`);

        // 【修改】在用户成功连接后，才加载消息历史
        await this.loadMessages();

        const initialHistory = this.messages.slice(-20);
        const hasMoreHistory = this.messages.length > 20;

        const welcomeMessage = {
            type: MSG_TYPE_WELCOME,
            payload: {
                message: `👏 欢迎 ${username} 加入聊天室 💬!`,
                sessionId: sessionId,
                history: initialHistory,
                hasMoreHistory: hasMoreHistory, // 告知客户端是否有更多历史记录
                userCount: this.sessions.size
            }
        };
        
        try {
            ws.send(JSON.stringify(welcomeMessage));
        } catch (e) {
            this.debugLog(`❌ Failed to send welcome message to 👦 ${username}: ${e.message}`, 'ERROR');
        }

        this.broadcast({ 
            type: MSG_TYPE_USER_JOIN, 
            payload: { 
                username,
                userCount: this.sessions.size
            } 
        }, sessionId);

        this.broadcastUserListUpdate();
        await this.saveState();
    }

    // ============ WebSocket 事件处理器 ============
    async webSocketMessage(ws, message) {
        const sessionId = ws.sessionId;
        const session = this.sessions.get(sessionId);
        
        if (!session) {
            this.debugLog(`❌ 未找到WebSocket的会话 (SessionId: ${sessionId})`, 'ERROR');
            ws.close(1011, "未找到会话。");
            return;
        }

        session.lastSeen = Date.now();
        // this.debugLog(`📨 收到用户： 👦  ${session.username} 的消息: ${message.substring(0, 150)}...`);

        try {
            const data = JSON.parse(message);
            const textPayload = data.payload?.text || '';

            // ✨ 核心修复：优先处理 @头条 任务，无论前端发送的 type 是什么
            if (textPayload.includes('@头条')) {
                // 强制将此消息作为普通聊天消息处理，以触发我们的特殊逻辑
                await this.handleChatMessage(session, data.payload);
                return; // 处理完毕，直接返回，避免进入下面的 switch
            }

            // 如果不是@头条任务，则按原逻辑继续
            switch (data.type) {
                case MSG_TYPE_CHAT:
                    await this.handleChatMessage(session, data.payload); 
                    break;
                case MSG_TYPE_GEMINI_CHAT:
                    await this.handleGeminiChatMessage(session, data.payload);
                    break;
                case 'deepseek_chat':
                    await this.handleDeepSeekChatMessage(session, data.payload);
                    break;
                case 'kimi_chat':
                    await this.handleKimiChatMessage(session, data.payload);
                    break;
                case MSG_TYPE_DELETE:
                    await this.handleDeleteMessageRequest(session, data.payload);
                    break;
                case MSG_TYPE_HEARTBEAT:
                    // this.debugLog(`💓 收到心跳包💓 👦  ${session.username}`, 'HEARTBEAT');
                    break;
                case 'offer':
                case 'answer':
                case 'candidate':
                case 'call_end':
                    this.forwardRtcSignal(data.type, session, data.payload);
                    break;
                default:
                    this.debugLog(`⚠️ 未处理的消息类型: ${data.type} 来自 👦 ${session.username}`, 'WARN', data);
            }
        } catch (e) { 
            this.debugLog(`❌ 解析来自 👦 ${session.username} 的WebSocket消息失败: ${e.message}`, 'ERROR');
        }
    }

    // ============ 核心业务逻辑 ============
    async handleChatMessage(session, payload) {
        // 【修改】在处理第一条消息前，确保历史已加载
        await this.loadMessages();
        
        this.debugLog(`💬 正在处理用户：👦 ${session.username} 的消息`, 'INFO', payload);
        
        let messageContentValid = false;
        const messageType = payload.type; 
        
        if (messageType === 'text' || messageType === 'chat') { 
            if (payload.text && payload.text.trim().length > 0) {
                messageContentValid = true;
            }
        } else if (messageType === 'image') {
            if (payload.imageUrl) {
                messageContentValid = true;
            }
        } else if (messageType === 'audio') {
            if (payload.audioUrl) {
                messageContentValid = true;
            }
        } else {
            this.debugLog(`⚠️ 不支持的消息类型或无效内容: ${messageType} from 👦 ${session.username}`, 'WARN', payload);
            try {
                session.ws.send(JSON.stringify({
                    type: MSG_TYPE_ERROR,
                    payload: { message: "不支持的消息类型或无效内容" }
                }));
            } catch (e) { /* silently fail */ }
            return;
        }

        if (!messageContentValid) {
            this.debugLog(`❌ 消息内容无效或为空 ${messageType} from 👦 ${session.username}`, 'WARN', payload);
            try {
                session.ws.send(JSON.stringify({
                    type: MSG_TYPE_ERROR,
                    payload: { message: "消息内容无效或为空。" }
                }));
            } catch (e) { /* silently fail */ }
            return;
        }

        const textContentToCheckLength = payload.text || payload.caption || '';
        const maxLength = parseInt(this.env.MAX_CONTENT_LENGTH) || 10000;
        if (textContentToCheckLength.length > maxLength) {
            this.debugLog(`❌ 消息文本或标题过长，请控制在${maxLength}字符以内 👦 ${session.username}`, 'WARN');
            try {
                session.ws.send(JSON.stringify({
                    type: MSG_TYPE_ERROR,
                    payload: { message: `❗ 消息文本或标题过长，请控制在${maxLength}字符以内` }
                }));
            } catch (e) {
                this.debugLog(`❌ Failed to send error message to 👦 ${session.username}: ${e.message}`, 'ERROR');
            }
            return;
        }
        
        const message = {
            id: payload.id || crypto.randomUUID(),
            username: session.username,
            timestamp: payload.timestamp || Date.now(),
            text: payload.text?.trim() || '',
            type: messageType === 'chat' ? 'text' : messageType 
        };
        
        if (messageType === 'image') {
            message.imageUrl = payload.imageUrl; 
            message.filename = payload.filename;
            message.size = payload.size;
            message.caption = payload.caption?.trim() || ''; 
        } else if (messageType === 'audio') { 
            message.audioUrl = payload.audioUrl;
            message.filename = payload.filename;
            message.size = payload.size;
        }
        
        // 新增：检查是否是头条任务
        if (message.text.includes('@头条')) {
            // 1. 准备任务对象
            const toutiaoTask = {
                originalMessageId: message.id,
                originalText: message.text,
                username: session.username,
                timestamp: Date.now()
            };
            
            // 2. 将任务提交到头条服务
            // 使用 waitUntil 确保任务在后台完成，不阻塞当前响应
            this.ctx.waitUntil(this.handleToutiaoTask(session, {
                id: toutiaoTask.originalMessageId,
                text: toutiaoTask.originalText,
                timestamp: toutiaoTask.timestamp
            }));

            // 3. 立即给用户一个反馈
            message.text += `\n\n> (⏳ 已加入头条内容生成队列...)`;
        }
        
        // 新增：检查是否是知乎热点任务
        if (message.text.startsWith('/知乎')) {
            const commandText = message.text.trim();
            
            // 处理不同的知乎命令
            if (commandText === '/知乎') {
                // 获取热点话题列表
                this.ctx.waitUntil(this.handleZhihuHotTask(session, {
                    id: message.id,
                    text: commandText,
                    timestamp: Date.now()
                }));
                message.text += `\n\n> (🔍 正在获取知乎实时热点...)`;
            } else if (commandText.startsWith('/知乎文章')) {
                // 基于热点生成文章
                const topicInfo = commandText.replace('/知乎文章', '').trim();
                this.ctx.waitUntil(this.generateZhihuArticle(session, topicInfo || '1'));
                message.text += `\n\n> (📝 正在基于知乎热点生成文章...)`;
            } else if (commandText.startsWith('/知乎话题')) {
                // 基于热点生成相关话题
                const keyword = commandText.replace('/知乎话题', '').trim();
                if (keyword) {
                    this.ctx.waitUntil(this.handleZhihuTopicGeneration(session, keyword));
                    message.text += `\n\n> (🎯 正在基于"${keyword}"生成相关话题...)`;
                } else {
                    // 如果没有提供关键词，使用当前热门话题作为基础
                    const topics = await zhihuHotService.getHotTopicsForContent(15);
                    if (topics.length > 0) {
                        const defaultKeyword = topics[0].title.split(' ')[0] || '热点';
                        this.ctx.waitUntil(this.handleZhihuTopicGeneration(session, defaultKeyword));
                        message.text += `\n\n> (🎯 正在基于当前热点"${defaultKeyword}"生成相关话题...)`;
                    } else {
                        this.ctx.waitUntil(this.handleZhihuTopicGeneration(session, '热门话题'));
                        message.text += `\n\n> (🎯 正在基于热门话题生成相关话题...)`;
                    }
                }
            }
        }
        
        await this.addAndBroadcastMessage(message);
    }

    async handleGeminiChatMessage(session, payload) {
        const model = payload.model || 'gemini';
        this.debugLog(`💬 [AI] Processing ${model} chat from 👦 ${session.username}`, 'INFO', payload);

        // ✨ 新增：创建一个绑定到此请求的日志记录器
        const logCallback = (message, level = 'INFO', data = null) => {
            this.debugLog(`[AI] ${message}`, level, data);
        };

        // 1. Post the user's original question immediately, with a "thinking" indicator.
        const thinkingMessage = {
            id: payload.id || crypto.randomUUID(),
            username: session.username,
            timestamp: payload.timestamp || Date.now(),
            text: `@机器人小助手 ${payload.text}\n\n> ❤️ 小助手正在思考，请稍候...`,
            type: 'text',
            original_user: session.username, // Keep track of who asked
        };
        await this.addAndBroadcastMessage(thinkingMessage);

        try {
            // 2. Prepare history and call the AI (which may involve tool calls)
            const history = this.messages
                .filter(m => m.type === 'text')
                .slice(-10)
                .map(m => ({
                    role: m.username === '机器人小助手' ? 'assistant' : 'user',
                    content: m.text
                }));

            let answer;
            if (model === 'kimi') {
                answer = await getKimiChatAnswer(payload.text, history, this.env, logCallback);
            } else {
                // 将历史记录转换为Gemini格式
                const geminiHistory = history.map(h => ({
                    role: h.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: h.content }]
                }));
                answer = await getGeminiChatAnswer(payload.text, geminiHistory, this.env, logCallback);
            }

            // 3. Find the original "thinking" message
            const messageIndex = this.messages.findIndex(m => m.id === thinkingMessage.id);
            if (messageIndex !== -1) {
                // 4. Update the message with the final answer
                this.messages[messageIndex].text = `@${thinkingMessage.original_user} ${payload.text}\n\n**机器人小助手**:\n${answer}`;
                this.messages[messageIndex].timestamp = Date.now(); // Update timestamp to reflect final answer time

                this.debugLog(`💬 [AI] Final answer generated. Updating message ${thinkingMessage.id}`);

                // 5. Save and broadcast the *updated* message
                await this.saveMessages();
                this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });

            } else {
                 this.debugLog(`❌ [AI] Could not find original message ${thinkingMessage.id} to update.`, 'ERROR');
                 // Fallback: send a new message if the original is gone
                 const botMessage = {
                    id: crypto.randomUUID(),
                    username: "机器人小助手",
                    timestamp: Date.now(),
                    text: `@${session.username} ${answer}`,
                    type: 'text'
                };
                await this.addAndBroadcastMessage(botMessage);
            }

        } catch (error) {
            this.debugLog(`❌ [AI] ${model} chat processing failed: ${error.message}`, 'ERROR', error);
            // Also update the original message with an error
            const messageIndex = this.messages.findIndex(m => m.id === thinkingMessage.id);
            if (messageIndex !== -1) {
                this.messages[messageIndex].text += `\n\n> ❌ 抱歉，小助手出错了，请稍后再试。`;
                await this.saveMessages();
                this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
            }
        }
    }

    async handleDeepSeekChatMessage(session, payload) {
        this.debugLog(`💬 [AI] Processing deepseek chat from 👦 ${session.username}`, 'INFO', payload);

        // ✨ 新增：创建一个绑定到此请求的日志记录器
        const logCallback = (message, level = 'INFO', data = null) => {
            this.debugLog(`[AI] ${message}`, level, data);
        };

        // 1. Post the user's original question immediately, with a "thinking" indicator.
        const thinkingMessage = {
            id: payload.id || crypto.randomUUID(),
            username: session.username,
            timestamp: payload.timestamp || Date.now(),
            text: `@机器人小助手 ${payload.text}\n\n> ❤️ 小助手正在思考，请稍候...`,
            type: 'text',
            original_user: session.username, // Keep track of who asked
        };
        await this.addAndBroadcastMessage(thinkingMessage);

        try {
            // 2. Prepare history and call the AI (which may involve tool calls)
            const history = this.messages
                .filter(m => m.type === 'text')
                .slice(-10)
                .map(m => ({
                    role: m.username === '机器人小助手' ? 'assistant' : 'user',
                    content: m.text
                }));

            // 3. Call DeepSeek AI
            const { getDeepSeekChatAnswer } = await import('./ai.js');
            const answer = await getDeepSeekChatAnswer(payload.text, history, this.env, logCallback);

            // 4. Find the original "thinking" message
            const messageIndex = this.messages.findIndex(m => m.id === thinkingMessage.id);
            if (messageIndex !== -1) {
                // 5. Update the message with the final answer
                this.messages[messageIndex].text = `@${thinkingMessage.original_user} ${payload.text}\n\n**机器人小助手**:\n${answer}`;
                this.messages[messageIndex].timestamp = Date.now(); // Update timestamp to reflect final answer time

                this.debugLog(`💬 [AI] Final answer generated. Updating message ${thinkingMessage.id}`);

                // 5. Save and broadcast the *updated* message
                await this.saveMessages();
                this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });

            } else {
                 this.debugLog(`❌ [AI] Could not find original message ${thinkingMessage.id} to update.`, 'ERROR');
                 // Fallback: send a new message if the original is gone
                 const botMessage = {
                    id: crypto.randomUUID(),
                    username: "机器人小助手",
                    timestamp: Date.now(),
                    text: `@${session.username} ${answer}`,
                    type: 'text'
                };
                await this.addAndBroadcastMessage(botMessage);
            }

        } catch (error) {
            this.debugLog(`❌ [AI] deepseek chat processing failed: ${error.message}`, 'ERROR', error);
            // Also update the original message with an error
            const messageIndex = this.messages.findIndex(m => m.id === thinkingMessage.id);
            if (messageIndex !== -1) {
                this.messages[messageIndex].text += `\n\n> ❌ 抱歉，小助手处理问题时遇到了错误：${error.message}`;
                await this.saveMessages();
                this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
            } else {
                 // Fallback: send a new error message if the original is gone
                 const errorMessage = {
                    id: crypto.randomUUID(),
                    username: "机器人小助手",
                    timestamp: Date.now(),
                    text: `@${session.username} 抱歉，小助手处理问题时遇到了错误：${error.message}`,
                    type: 'text'
                };
                await this.addAndBroadcastMessage(errorMessage);
            }
        }
    }

    async handleKimiChatMessage(session, payload) {
        this.debugLog(`💬 [AI] Processing kimi chat from 👦 ${session.username}`, 'INFO', payload);

        // ✨ 新增：创建一个绑定到此请求的日志记录器
        const logCallback = (message, level = 'INFO', data = null) => {
            this.debugLog(`[AI] ${message}`, level, data);
        };

        // 1. Post the user's original question immediately, with a "thinking" indicator.
        const thinkingMessage = {
            id: payload.id || crypto.randomUUID(),
            username: session.username,
            timestamp: payload.timestamp || Date.now(),
            text: `@机器人小助手 ${payload.text}\n\n> ❤️ 小助手正在思考，请稍候...`,
            type: 'text',
            original_user: session.username, // Keep track of who asked
        };
        await this.addAndBroadcastMessage(thinkingMessage);

        try {
            // 2. Prepare history and call the AI (which may involve tool calls)
            const history = this.messages
                .filter(m => m.type === 'text')
                .slice(-10)
                .map(m => ({
                    role: m.username === '机器人小助手' ? 'assistant' : 'user',
                    content: m.text
                }));

            // 3. Call Kimi AI
            const { getKimiChatAnswer } = await import('./ai.js');
            const answer = await getKimiChatAnswer(payload.text, history, this.env, logCallback);

            // 4. Find the original "thinking" message
            const messageIndex = this.messages.findIndex(m => m.id === thinkingMessage.id);
            if (messageIndex !== -1) {
                // 5. Update the message with the final answer
                this.messages[messageIndex].text = `@${thinkingMessage.original_user} ${payload.text}\n\n**机器人小助手**:\n${answer}`;
                this.messages[messageIndex].timestamp = Date.now(); // Update timestamp to reflect final answer time

                this.debugLog(`💬 [AI] Final answer generated. Updating message ${thinkingMessage.id}`);

                // 5. Save and broadcast the *updated* message
                await this.saveMessages();
                this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });

            } else {
                 this.debugLog(`❌ [AI] Could not find original message ${thinkingMessage.id} to update.`, 'ERROR');
                 // Fallback: send a new message if the original is gone
                 const botMessage = {
                    id: crypto.randomUUID(),
                    username: "机器人小助手",
                    timestamp: Date.now(),
                    text: `@${session.username} ${answer}`,
                    type: 'text'
                };
                await this.addAndBroadcastMessage(botMessage);
            }

        } catch (error) {
            this.debugLog(`❌ [AI] kimi chat processing failed: ${error.message}`, 'ERROR', error);
            // Also update the original message with an error
            const messageIndex = this.messages.findIndex(m => m.id === thinkingMessage.id);
            if (messageIndex !== -1) {
                this.messages[messageIndex].text += `\n\n> ❌ 抱歉，小助手处理问题时遇到了错误：${error.message}`;
                await this.saveMessages();
                this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
            } else {
                 // Fallback: send a new error message if the original is gone
                 const errorMessage = {
                    id: crypto.randomUUID(),
                    username: "机器人小助手",
                    timestamp: Date.now(),
                    text: `@${session.username} 抱歉，小助手处理问题时遇到了错误：${error.message}`,
                    type: 'text'
                };
                await this.addAndBroadcastMessage(errorMessage);
            }
        }
    }

  // 将第二个函数重命名为 handleDeleteMessageRequest
async handleDeleteMessageRequest(session, payload) { 
    // 【修改】在处理删除消息前，确保历史已加载
    await this.loadMessages();
    
    const messageId = payload.id;
    if (!messageId) {
        this.debugLog(`❌ 正在处理用户： 👦 ${session.username} 的消息删除请求，message ID.`, 'WARN');
        return;
    }

    const initialLength = this.messages.length;
    const messageToDelete = this.messages.find(m => m.id === messageId);

    if (messageToDelete && messageToDelete.username === session.username) {
        this.messages = this.messages.filter(m => m.id !== messageId);
        
        if (this.messages.length < initialLength) {
            this.debugLog(`🗑️ 此消息： ${messageId} 已被用户： 👦 ${session.username}删除.`);
            await this.saveMessages();
            this.broadcast({ type: MSG_TYPE_DELETE, payload: { messageId } });
        }
    } else {
        let reason = messageToDelete ? "权限被拒绝" : "未找到消息";
        this.debugLog(`🚫 用户 👦 ${session.username} 尝试删除消息 ${messageId} 未获授权。原因: ${reason}`, 'WARN');
        
        try {
            session.ws.send(JSON.stringify({
                type: MSG_TYPE_ERROR,
                payload: { message: "你不能删除这条消息。" }
            }));
        } catch (e) {
            this.debugLog(`❌ 无法发送错误信息 to 👦 ${session.username}: ${e.message}`, 'ERROR');
        }
    }
}

    async addAndBroadcastMessage(message) {
        this.messages.push(message);
        if (this.messages.length > 500) this.messages.shift();
        
        await this.saveMessages();
        this.broadcast({ type: MSG_TYPE_CHAT, payload: message });
    }

    // 统一的会话清理函数
    cleanupSession(sessionId, closeInfo = {}) {
        const session = this.sessions.get(sessionId);
        // 获取用户名，如果会话不存在则默认为 'unknown'
        const username = session ? session.username : 'unknown';

        if (session) {
            this.sessions.delete(sessionId);
            const { code = 'N/A', reason = 'N/A', wasClean = 'N/A' } = closeInfo;
            // 打印会话所属的用户
            this.debugLog(`💤 断开用户连接: 👦 ${username} (Session: ${sessionId}). Code: ${code}, 原因: ${reason}, 清理: ${wasClean}`);
            
            // 广播用户离开消息（可选，如果前端只依赖用户列表更新，此消息可省略）
            this.broadcast({ 
                type: MSG_TYPE_USER_LEAVE, 
                payload: { 
                    username: username,
                    userCount: this.sessions.size
                } 
            });
            
            // 用户离开后，广播最新的在线用户列表给所有剩余客户端
            this.broadcastUserListUpdate();

            this.debugLog(`👭 当前有效会话数: ${this.sessions.size}`);
            
            // 使用 waitUntil 确保状态保存在实例休眠前完成
            this.ctx.waitUntil(this.saveState());
        } else {
             // 对于找不到会话的情况也打印用户名（虽然是unknown）
            this.debugLog(`💤 尝试清理未知会话 (SessionId: ${sessionId}). Code: ${closeInfo.code}, 原因: ${closeInfo.reason}`, 'WARN');
        }
    }

    fetchHistory(since = 0) {
        return since > 0 ? this.messages.filter(msg => msg.timestamp > since) : this.messages;
    }

    broadcast(message, excludeSessionId = null) {
        const stringifiedMessage = JSON.stringify(message);
        let activeSessions = 0;
        const disconnectedSessions = [];
        const activeUsernames = []; 
        
        this.sessions.forEach((session, sessionId) => {
            if (sessionId === excludeSessionId) {
                return;
            }
            
            try {
                if (session.ws.readyState === WebSocket.OPEN) {
                    session.ws.send(stringifiedMessage);
                    activeSessions++;
                    // 仅在广播普通消息时，才收集用户名用于日志
                    if (message.type !== MSG_TYPE_DEBUG_LOG && message.type !== MSG_TYPE_USER_LIST_UPDATE) {
                         activeUsernames.push(session.username); 
                    }
                } else {
                    disconnectedSessions.push(sessionId);
                }
            } catch (e) {
                this.debugLog(`💥 Failed to send message to 👦 ${session.username}: ${e.message}`, 'ERROR');
                disconnectedSessions.push(sessionId);
            }
        });
        
        // 清理断开的会话
        disconnectedSessions.forEach(sessionId => {
            this.cleanupSession(sessionId, { code: 1011, reason: 'Broadcast failed', wasClean: false });
        });
        
        // 避免调试日志的广播产生无限循环
        // 并且避免对 MSG_TYPE_USER_LIST_UPDATE 消息重复打印用户列表
        if (message.type !== MSG_TYPE_DEBUG_LOG && message.type !== MSG_TYPE_USER_LIST_UPDATE) {
            let logMessage = `📡 广播消息给 ${activeSessions} 位活跃会话 🟢`;
            
            if (activeSessions > 0) {
                const userListString = activeUsernames.join(', ');
                logMessage += `：${userListString}`; 
            } else {
                logMessage += ` (无活跃用户)`; 
            }
            
            this.debugLog(logMessage, 'INFO');
        }
    }

    // ============ 清理方法 ============
    async cleanup() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        // 保存最终状态
        if (this.messages !== null) {
            await this.saveMessages();
        }
        await this.saveState();
        
        this.debugLog("🧹 清理结束");
    }
}