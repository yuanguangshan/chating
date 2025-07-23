// 文件: src/toutiaoDO.js (修正版)
import { DurableObject } from "cloudflare:workers";
import { ToutiaoTaskProcessor, ToutiaoQueueManager } from './toutiaoService.js';

// ... (常量定义保持不变) ...
const TOUTIAO_QUEUE_KEY = 'toutiao_task_queue';
const TASK_RESULTS_KEY = 'toutiao_task_results';
const SERVICE_STATS_KEY = 'toutiao_service_stats';

export class ToutiaoServiceDO2 extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        const logger = {
            log: (message, data) => this._log(message, 'INFO', data),
            error: (message, error) => this._log(message, 'ERROR', error),
        };
        this.processor = new ToutiaoTaskProcessor(env, logger);
        this.queueManager = new ToutiaoQueueManager(ctx.storage, logger);
        this.isInitialized = false;
    }

    // ... (所有其他方法: _log, processAndCallback, _performCallback, initialize, 等等... 全部保持不变) ...
    _log(message, level = 'INFO', data = null) {
        const timestamp = new Date().toISOString();
        console.log(`[ToutiaoDO] [${timestamp}] [${level}] ${message}`, data || '');
    }
    async processAndCallback(task) {
        const { payload, callbackInfo } = task;
        this._log(`收到实时任务: ${task.command}`, { payload, callbackInfo });
        let finalContent, metadata = {};
        try {
            const processorTask = { text: payload.content, username: callbackInfo.username, id: callbackInfo.messageId };
            const result = await this.processor.processTask(processorTask);
            const originalText = `> (原始命令: /头条 ${payload.content})`;
            if (result.success) {
                const publishStatus = result.publishResult?.data?.msg || (result.publishResult?.success ? '成功' : '未知');
                finalContent = `${originalText}\n\n` + `✅ **头条内容已生成并发布**\n\n` + `**标题**: ${result.title}\n` + `**发布状态**: ${publishStatus}\n` + `**智能模板**: ${result.templateUsed}\n\n` + `---\n${result.content}`;
                metadata = { toutiaoResult: result };
                await this.updateStats(true);
            } else {
                finalContent = `${originalText}\n\n> (❌ **头条任务处理失败**: ${result.error})`;
                await this.updateStats(false);
            }
        } catch (error) {
            this._log(`处理实时任务时发生严重错误`, 'ERROR', error);
            const originalText = `> (原始命令: /头条 ${payload.content})`;
            finalContent = `${originalText}\n\n> (💥 **系统异常**: 处理任务时发生意外错误。详情: ${error.message})`;
            await this.updateStats(false);
        }
        await this._performCallback(callbackInfo, finalContent, metadata);
    }
    async _performCallback(callbackInfo, finalContent, metadata) {
        try {
            const chatroomId = this.env.CHAT_ROOM_DO.idFromName(callbackInfo.roomName);
            const chatroomStub = this.env.CHAT_ROOM_DO.get(chatroomId);
            this._log(`正在回调房间: ${callbackInfo.roomName}, 消息ID: ${callbackInfo.messageId}`);
            await chatroomStub.updateMessage(callbackInfo.messageId, finalContent, metadata);
            this._log(`回调成功!`);
        } catch (callbackError) {
            this._log(`FATAL: 回调到房间 ${callbackInfo.roomName} 失败! 用户 ${callbackInfo.username} 将不会看到消息 ${callbackInfo.messageId} 的更新。`, 'ERROR', callbackError);
        }
    }
    async initialize() {
        if (this.isInitialized) return;
        const stats = await this.ctx.storage.get(SERVICE_STATS_KEY) || { totalTasks: 0, successfulTasks: 0, failedTasks: 0, lastProcessedAt: null, createdAt: new Date().toISOString() };
        await this.ctx.storage.put(SERVICE_STATS_KEY, stats);
        this.isInitialized = true;
        this._log('头条服务已初始化');
    }
    async processTask(task) {
        await this.initialize();
        const result = await this.processor.processTask(task);
        await this.updateStats(result.success);
        await this.saveTaskResult(result);
        return result;
    }
    async addTask(task) { await this.initialize(); return await this.queueManager.addTask(task); }
    async processQueue() {
        await this.initialize();
        const results = await this.queueManager.processQueue(this.processor);
        for (const result of results) { await this.saveTaskResult(result); await this.updateStats(result.success); }
        return results;
    }
    async updateStats(success) {
        const stats = await this.ctx.storage.get(SERVICE_STATS_KEY) || {};
        stats.totalTasks = (stats.totalTasks || 0) + 1;
        if (success) { stats.successfulTasks = (stats.successfulTasks || 0) + 1; } else { stats.failedTasks = (stats.failedTasks || 0) + 1; }
        stats.lastProcessedAt = new Date().toISOString();
        await this.ctx.storage.put(SERVICE_STATS_KEY, stats);
    }
    async saveTaskResult(result) {
        const results = await this.ctx.storage.get(TASK_RESULTS_KEY) || {};
        results[result.taskId] = { ...result, completedAt: new Date().toISOString() };
        await this.ctx.storage.put(TASK_RESULTS_KEY, results);
    }
    async getStats() { await this.initialize(); return await this.ctx.storage.get(SERVICE_STATS_KEY); }
    async getTaskResult(taskId) { const results = await this.ctx.storage.get(TASK_RESULTS_KEY) || {}; return results[taskId]; }
    async getAllTaskResults(limit = 50) {
        const results = await this.ctx.storage.get(TASK_RESULTS_KEY) || {};
        return Object.values(results).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).slice(0, limit);
    }
    async cleanupOldResults(daysToKeep = 7) {
        const results = await this.ctx.storage.get(TASK_RESULTS_KEY) || {};
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        let cleanedCount = 0;
        for (const [taskId, result] of Object.entries(results)) { if (new Date(result.completedAt) < cutoffDate) { delete results[taskId]; cleanedCount++; } }
        if (cleanedCount > 0) { await this.ctx.storage.put(TASK_RESULTS_KEY, results); this._log(`🧹 清理了 ${cleanedCount} 个过期任务结果`); }
        return cleanedCount;
    }

    // ✅ [核心修正] 修改 fetch 方法以处理内部任务
    async fetch(request) {
        const url = new URL(request.url);
        const method = request.method;
        this._log(`收到请求: ${method} ${url.pathname}`);

        // 1. 优先处理来自 worker 的内部任务派发 (POST请求)
        if (method === 'POST') {
            try {
                const task = await request.json();
                // 通过检查 task 结构来判断是内部任务还是公共API任务
                if (task.command && task.callbackInfo) {
                    this._log(`收到内部任务: ${task.command}`, 'INFO', task);
                    this.ctx.waitUntil(this.processAndCallback(task));
                    return new Response('Task accepted by ToutiaoDO', { status: 202 });
                }
            } catch (e) {
                this._log('解析POST请求失败，可能不是内部任务', 'WARN', e);
            }
        }

        // 2. 如果不是内部任务，则执行原有的公共 API 路由逻辑
        try {
            await this.initialize();
            // ... (原有的 switch case 逻辑完全不变) ...
            switch (url.pathname) {
                case '/task':
                case '/api/toutiao/task':
                    if (method === 'POST') {
                        const task = await request.json();
                        const result = await this.processTask(task);
                        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
                    }
                    break;
                // ... 其他所有 case ...
                case '/queue': case '/api/toutiao/queue': if (method === 'POST') { const task = await request.json(); const queueLength = await this.addTask(task); return new Response(JSON.stringify({ queueLength }), { headers: { 'Content-Type': 'application/json' } }); } else if (method === 'GET') { const status = await this.queueManager.getQueueStatus(); return new Response(JSON.stringify(status), { headers: { 'Content-Type': 'application/json' } }); } else if (method === 'DELETE') { const results = await this.processQueue(); return new Response(JSON.stringify({ results }), { headers: { 'Content-Type': 'application/json' } }); } break;
                case '/clearQueue': case '/api/toutiao/clearQueue': if (method === 'POST') { await this.ctx.storage.delete(TOUTIAO_QUEUE_KEY); return new Response(JSON.stringify({ message: 'Queue cleared' }), { headers: { 'Content-Type': 'application/json' } }); } break;
                case '/stats': case '/api/toutiao/stats': if (method === 'GET') { const stats = await this.getStats(); return new Response(JSON.stringify(stats), { headers: { 'Content-Type': 'application/json' } }); } break;
                case '/results': case '/api/toutiao/results': if (method === 'GET') { const taskId = url.searchParams.get('id'); if (taskId) { const result = await this.getTaskResult(taskId); return new Response(JSON.stringify(result || null), { headers: { 'Content-Type': 'application/json' } }); } else { const limit = parseInt(url.searchParams.get('limit')) || 50; const results = await this.getAllTaskResults(limit); return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } }); } } break;
                case '/status': case '/api/toutiao/status': if (method === 'GET') { const taskId = url.pathname.split('/')[2] || url.pathname.split('/')[3]; if (taskId) { const result = await this.getTaskResult(taskId); if (result) { return new Response(JSON.stringify({ taskId, status: result.success ? 'completed' : 'failed', data: result }), { headers: { 'Content-Type': 'application/json' } }); } else { return new Response(JSON.stringify({ taskId, status: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }); } } return new Response(JSON.stringify({ error: 'Missing task ID in path /status/{taskId}' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); } break;
                case '/cleanup': case '/api/toutiao/cleanup': if (method === 'POST') { const days = parseInt(url.searchParams.get('days')) || 7; const cleanedCount = await this.cleanupOldResults(days); return new Response(JSON.stringify({ cleanedCount }), { headers: { 'Content-Type': 'application/json' } }); } break;
                case '/health': case '/api/toutiao/health': return new Response(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } });
            }
            return new Response('API Endpoint Not Found', { status: 404 });
        } catch (error) {
            this._log(`API请求处理失败: ${error.message}`, 'ERROR', error);
            return new Response(JSON.stringify({ error: error.message, stack: error.stack }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
    }
}
