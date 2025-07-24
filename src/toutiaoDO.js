// 文件: src/toutiaoDO.js (最终修正版)

import { DurableObject } from "cloudflare:workers";
// ✅ [核心] 导入任务处理器，它包含了所有业务逻辑
import { ToutiaoTaskProcessor } from './toutiaoService.js';

export class ToutiaoServiceDO2 extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        this.taskProcessor = null;
        this.initialized = false;
    }
    
    static TASK_RESULTS_KEY = 'toutiao_results';
    static TASK_QUEUE_KEY = 'toutiao_queue';

    async initialize() {
        if (this.initialized) return;
        this._log('正在初始化头条任务处理器...');
        this.taskProcessor = new ToutiaoTaskProcessor(this.env, console);
        this.initialized = true;
        this._log('头条任务处理器已初始化');
    }

    _log(message, level = 'INFO', data = null) {
        const logData = data ? JSON.stringify(data) : '';
        console.log(`[ToutiaoDO] [${new Date().toISOString()}] [${level}] ${message} ${logData}`);
    }

    // ✅ [新增方法] 专门处理来自管理面板的生成请求
    async handleGenerateFromInspiration(request) {
        try {
            await this.initialize(); // 确保处理器已初始化

            const body = await request.json();
            const { inspiration, roomName, secret } = body;

            // 1. 验证密钥
            if (secret !== this.env.ADMIN_SECRET) {
                return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            // 2. 验证输入
            if (!inspiration || !roomName) {
                return new Response(JSON.stringify({ success: false, message: 'Missing inspiration data or room name' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }

            this._log(`收到管理面板生成请求`, 'INFO', { title: inspiration.title, room: roomName });

            // 3. 创建一个符合 taskProcessor 要求的任务对象
            const taskContent = inspiration.contentPrompt || inspiration.title;
            const taskId = `admin-${crypto.randomUUID()}`; // 为管理任务生成唯一ID
            const processorTask = {
                id: taskId,
                text: taskContent,
                username: 'admin_panel', // 标记来源
            };

            // 4. 异步处理任务，不阻塞响应
            this.ctx.waitUntil(this.processAndNotify(processorTask, roomName));

            // 5. 立即返回成功响应，告知前端任务已接受
            return new Response(JSON.stringify({ success: true, taskId: taskId, message: '任务已创建，正在后台处理...' }), { status: 202, headers: { 'Content-Type': 'application/json' } });

        } catch (error) {
            this._log(`处理管理面板生成请求时发生错误`, 'ERROR', { message: error.message });
            return new Response(JSON.stringify({ success: false, message: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
    }

    // ✅ [新增方法] 封装后台处理和结果通知的完整流程
    async processAndNotify(processorTask, roomName) {
        // 添加到队列
        await this.addToQueue(processorTask.id, processorTask, 'admin');
        
        try {
            // 更新队列状态为处理中
            await this.updateQueueStatus(processorTask.id, 'processing');
            
            // 调用核心处理器执行任务
            const result = await this.taskProcessor.processTask(processorTask);

            let finalContent;
            if (result.success) {
                const articleUrl = `https://www.toutiao.com/article/${result.publishResult.data.data.pgc_id}/`;
                finalContent = `✅ **[后台任务] 文章已发布**\n\n` +
                               `### ${result.title}\n\n` +
                               `> ${result.summary}\n\n` +
                               `[🔗 点击查看文章](${articleUrl})`;
                this._log(`后台任务 ${processorTask.id} 处理成功`, 'INFO', result);
                
                // 更新队列状态为已完成
                await this.updateQueueStatus(processorTask.id, 'completed', {
                    title: result.title,
                    url: articleUrl
                });
            } else {
                finalContent = `> (❌ **[后台任务] 文章处理失败**: ${result.error || '未知错误'})`;
                this._log(`后台任务 ${processorTask.id} 处理失败`, 'ERROR', result);
                
                // 更新队列状态为失败
                await this.updateQueueStatus(processorTask.id, 'failed', {
                    error: result.error || '未知错误'
                });
            }

            // 将结果发送到指定的房间
            const callbackInfo = {
                roomName: roomName,
                // 对于后台任务，我们没有原始消息ID，所以创建一个新的
                messageId: `notification-${processorTask.id}`
            };
            await this.performCallback(callbackInfo, finalContent, true); // true表示这是一个新消息
        } catch (error) {
            this._log(`后台任务 ${processorTask.id} 发生异常`, 'ERROR', { message: error.message, stack: error.stack });
            
            // 保存失败任务结果
            await this.saveTaskResult(processorTask.id, {
                id: processorTask.id,
                title: processorTask.text.substring(0, 50) + '...',
                text: processorTask.text,
                error: error.message,
                status: 'failed',
                createdAt: new Date().toISOString(),
                type: 'inspiration',
                username: processorTask.username
            });
            
            // 更新队列状态为失败
            await this.updateQueueStatus(processorTask.id, 'failed', {
                error: error.message
            });
        } finally {
            // 仅在成功时保存任务结果
            if (result && result.success) {
                await this.saveTaskResult(processorTask.id, {
                    id: processorTask.id,
                    title: result.title,
                    summary: result.summary,
                    articleUrl: `https://www.toutiao.com/article/${result.publishResult.data.data.pgc_id}/`,
                    status: 'success',
                    createdAt: new Date().toISOString(),
                    type: 'inspiration'
                });
            }
            
            // 从队列中移除（延迟1秒，让前端有时间看到状态更新）
            setTimeout(async () => {
                await this.removeFromQueue(processorTask.id);
            }, 1000);
        }
    }

    // [现有方法] 处理来自聊天室的实时任务
    async processAndCallback(task) {
        const { command, payload, callbackInfo } = task;
        this._log(`收到实时任务: ${command}`, 'INFO', { payload, callbackInfo });

        // 添加到队列
        const taskId = callbackInfo.messageId;
        await this.addToQueue(taskId, { command, payload, callbackInfo }, 'chat');

        let finalContent;
        try {
            await this.initialize();

            const processorTask = {
                id: callbackInfo.messageId,
                text: payload.content,
                username: callbackInfo.username,
            };

            const result = await this.taskProcessor.processTask(processorTask);

            if (result.success) {
                const articleUrl = `https://www.toutiao.com/article/${result.publishResult.data.data.pgc_id}/`;
                finalContent = `✅ **头条文章已发布**\n\n` +
                               `### ${result.title}\n\n` +
                               `> ${result.summary}\n\n` +
                               `[🔗 点击查看文章](${articleUrl})`;
                this._log(`任务 ${callbackInfo.messageId} 处理成功`, 'INFO', result);
                
                // 保存成功任务结果
                await this.saveTaskResult(taskId, {
                    id: taskId,
                    title: result.title,
                    summary: result.summary,
                    articleUrl: articleUrl,
                    status: 'success',
                    createdAt: new Date().toISOString(),
                    type: 'chat',
                    roomName: callbackInfo.roomName,
                    username: callbackInfo.username
                });
            } else {
                throw new Error(result.error || '未知处理错误');
            }

        } catch (error) {
            this._log(`处理头条任务 ${command} 时发生错误`, 'ERROR', { message: error.message, stack: error.stack });
            finalContent = `> (❌ **头条任务处理失败**: ${error.message})`;
            
            // 保存失败任务结果
            await this.saveTaskResult(taskId, {
                id: taskId,
                title: command,
                error: error.message,
                status: 'failed',
                createdAt: new Date().toISOString(),
                type: 'chat',
                roomName: callbackInfo.roomName,
                username: callbackInfo.username
            });
        } finally {
            // 从队列中移除
            await this.removeFromQueue(taskId);
        }

        await this.performCallback(callbackInfo, finalContent);
    }

    // ✅ [修改] 增强回调函数，使其能处理新消息和更新旧消息
    async performCallback(callbackInfo, finalContent, isNewMessage = false) {
        try {
            if (!this.env.CHAT_ROOM_DO) {
                throw new Error("CHAT_ROOM_DO is not bound. Cannot perform callback.");
            }
            const chatroomId = this.env.CHAT_ROOM_DO.idFromName(callbackInfo.roomName);
            const chatroomStub = this.env.CHAT_ROOM_DO.get(chatroomId);

            // 根据 isNewMessage 判断是更新消息还是发送新消息
            const callbackUrl = isNewMessage ? "https://do-internal/api/post-system-message" : "https://do-internal/api/callback";
            const payload = isNewMessage ? 
                { content: finalContent } : 
                { messageId: callbackInfo.messageId, newContent: finalContent, status: 'success' };

            const response = await chatroomStub.fetch(callbackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Callback failed with status ${response.status}: ${errorText}`);
            }
            this._log(`✅ 成功回调到房间 ${callbackInfo.roomName}`, 'INFO', { messageId: callbackInfo.messageId, isNew: isNewMessage });

        } catch (callbackError) {
            this._log(`FATAL: 回调到房间 ${callbackInfo.roomName} 失败!`, 'FATAL', callbackError);
        }
    }

    // ✅ [修改] 更新 fetch 方法以包含新路由
    async fetch(request) {
        await this.initialize(); // 确保每次请求时都已初始化
        const url = new URL(request.url);
        const method = request.method;
        const pathname = url.pathname;

        // 路由1: 处理来自聊天室的实时任务
        if (method === 'POST' && pathname === '/internal-task') {
            const task = await request.json();
            this._log('收到内部任务: ' + task.command, 'INFO', task);
            this.ctx.waitUntil(this.processAndCallback(task));
            return new Response('Task accepted by ToutiaoDO', { status: 202 });
        }

        // 路由2: 处理来自管理面板的生成请求
        if (method === 'POST' && pathname === '/api/inspirations/generate') {
            return this.handleGenerateFromInspiration(request);
        }

        // 路由3: 其他API端点
        switch (pathname) {
            case '/api/toutiao/status':
                return new Response(JSON.stringify({ status: 'ok', initialized: this.initialized }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            case '/api/toutiao/results':
                if (method === 'GET') {
                    const taskId = url.searchParams.get('id');
                    if (taskId) {
                        const result = await this.getTaskResult(taskId);
                        return new Response(JSON.stringify(result || null), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    } else {
                        const limit = parseInt(url.searchParams.get('limit')) || 50;
                        const results = await this.getAllTaskResults(limit);
                        return new Response(JSON.stringify(results), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                }
                return new Response('Method Not Allowed', { status: 405 });
            case '/api/toutiao/queue':
                if (method === 'GET') {
                    const queue = await this.getTaskQueue();
                    return new Response(JSON.stringify({
                        length: queue.length,
                        tasks: queue
                    }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                } else if (method === 'DELETE') {
                    await this.clearTaskQueue();
                    return new Response(JSON.stringify({ success: true }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return new Response('Method Not Allowed', { status: 405 });
            case '/api/toutiao/stats':
                if (method === 'GET') {
                    const stats = await this.getStats();
                    return new Response(JSON.stringify(stats), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return new Response('Method Not Allowed', { status: 405 });
            default:
                return new Response('API Endpoint Not Found in ToutiaoDO', { status: 404 });
        }
    }

    async getTaskResult(taskId) {
        const TASK_RESULTS_KEY = `toutiao_results`;
        try {
            const resultsData = await this.ctx.storage.get(TASK_RESULTS_KEY);
            const results = resultsData ? JSON.parse(resultsData) : {};
            return results[taskId] || null;
        } catch (error) {
            console.error('[ToutiaoDO] Error getting task result:', error);
            return null;
        }
    }

    async getAllTaskResults(limit = 50) {
        const TASK_RESULTS_KEY = `toutiao_results`;
        try {
            const resultsData = await this.ctx.storage.get(TASK_RESULTS_KEY);
            const results = resultsData ? JSON.parse(resultsData) : [];
            
            // 确保是数组格式并排序（最新的在前面）
            const resultsArray = Array.isArray(results) ? results : [];
            return resultsArray
                .sort((a, b) => (b.createdAt || b.completedAt || 0) - (a.createdAt || a.completedAt || 0))
                .slice(0, limit);
        } catch (error) {
            console.error('[ToutiaoDO] Error getting all task results:', error);
            return [];
        }
    }

    async getTaskQueue() {
        const TASK_QUEUE_KEY = `toutiao_task_queue`;
        try {
            const queueData = await this.ctx.storage.get(TASK_QUEUE_KEY);
            return queueData ? JSON.parse(queueData) : [];
        } catch (error) {
            console.error('[ToutiaoDO] Error getting task queue:', error);
            return [];
        }
    }

    async clearTaskQueue() {
        const TASK_QUEUE_KEY = `toutiao_task_queue`;
        try {
            await this.ctx.storage.put(TASK_QUEUE_KEY, JSON.stringify([]));
            console.log('[ToutiaoDO] Task queue cleared');
        } catch (error) {
            console.error('[ToutiaoDO] Error clearing task queue:', error);
        }
    }

    async addToQueue(taskId, taskData, source) {
        const TASK_QUEUE_KEY = ToutiaoServiceDO2.TASK_QUEUE_KEY;
        try {
            const queueData = await this.ctx.storage.get(TASK_QUEUE_KEY);
            const queue = queueData ? JSON.parse(queueData) : [];
            
            const taskItem = {
                id: taskId,
                source: source, // 'admin' 或 'chat'
                data: taskData,
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            
            queue.push(taskItem);
            await this.ctx.storage.put(TASK_QUEUE_KEY, JSON.stringify(queue));
            this._log(`任务 ${taskId} 已添加到队列`, 'INFO', { queueLength: queue.length });
        } catch (error) {
            console.error('[ToutiaoDO] Error adding to queue:', error);
        }
    }

    async removeFromQueue(taskId) {
        const TASK_QUEUE_KEY = `toutiao_task_queue`;
        try {
            const queueData = await this.ctx.storage.get(TASK_QUEUE_KEY);
            if (!queueData) return;
            
            const queue = JSON.parse(queueData);
            const updatedQueue = queue.filter(task => task.id !== taskId);
            
            await this.ctx.storage.put(TASK_QUEUE_KEY, JSON.stringify(updatedQueue));
            this._log(`任务 ${taskId} 已从队列移除`, 'INFO', { queueLength: updatedQueue.length });
        } catch (error) {
            console.error('[ToutiaoDO] Error removing from queue:', error);
        }
    }

    async updateQueueStatus(taskId, status, result = null) {
        const TASK_QUEUE_KEY = `toutiao_task_queue`;
        try {
            const queueData = await this.ctx.storage.get(TASK_QUEUE_KEY);
            if (!queueData) return;
            
            const queue = JSON.parse(queueData);
            const taskIndex = queue.findIndex(task => task.id === taskId);
            
            if (taskIndex !== -1) {
                queue[taskIndex].status = status;
                queue[taskIndex].updatedAt = new Date().toISOString();
                if (result) {
                    queue[taskIndex].result = result;
                }
                await this.ctx.storage.put(TASK_QUEUE_KEY, JSON.stringify(queue));
            }
        } catch (error) {
            console.error('[ToutiaoDO] Error updating queue status:', error);
        }
    }

    async saveTaskResult(taskId, result) {
        const TASK_RESULTS_KEY = `toutiao_results`;
        try {
            const existingData = await this.ctx.storage.get(TASK_RESULTS_KEY);
            const results = existingData ? JSON.parse(existingData) : [];
            
            // 确保是数组格式
            const resultsArray = Array.isArray(results) ? results : [];
            
            // 添加新结果
            resultsArray.push(result);
            
            // 保存回存储（限制最多保存1000条记录）
            const limitedResults = resultsArray.slice(-1000);
            await this.ctx.storage.put(TASK_RESULTS_KEY, JSON.stringify(limitedResults));
            
            this._log(`任务结果已保存: ${taskId}`, 'INFO', { taskId, status: result.status });
        } catch (error) {
            console.error('[ToutiaoDO] Error saving task result:', error);
        }
    }

    async getStats() {
        try {
            const TASK_RESULTS_KEY = ToutiaoServiceDO2.TASK_RESULTS_KEY;
            const TASK_QUEUE_KEY = ToutiaoServiceDO2.TASK_QUEUE_KEY;
            
            // 确保存储上下文可用
            if (!this.ctx || !this.ctx.storage) {
                console.error('[ToutiaoDO] Storage context not available');
                return {
                    totalTasks: 0,
                    successfulTasks: 0,
                    failedTasks: 0,
                    pendingTasks: 0,
                    processingTasks: 0,
                    queueLength: 0,
                    recentTasks: [],
                    todayTasks: 0,
                    lastUpdated: new Date().toISOString(),
                    error: 'Storage context not available'
                };
            }
            
            // 获取所有结果
            const resultsData = await this.ctx.storage.get(TASK_RESULTS_KEY);
            const results = resultsData ? JSON.parse(resultsData) : [];
            
            // 获取队列
            const queueData = await this.ctx.storage.get(TASK_QUEUE_KEY);
            const queue = queueData ? JSON.parse(queueData) : [];
            
            // 确保结果是数组格式
            const resultsArray = Array.isArray(results) ? results : Object.values(results);
            const queueArray = Array.isArray(queue) ? queue : Object.values(queue);
            
            // 统计信息
            const stats = {
                totalTasks: resultsArray.length,
                successfulTasks: resultsArray.filter(r => r && r.status === 'success').length,
                failedTasks: resultsArray.filter(r => r && r.status === 'failed').length,
                pendingTasks: queueArray.filter(t => t && t.status === 'pending').length,
                processingTasks: queueArray.filter(t => t && t.status === 'processing').length,
                queueLength: queueArray.length,
                recentTasks: resultsArray.slice(-10).reverse(), // 最近10个任务
                todayTasks: resultsArray.filter(r => {
                    if (!r || !r.createdAt) return false;
                    const taskDate = new Date(r.createdAt || r.timestamp);
                    const today = new Date();
                    return taskDate.toDateString() === today.toDateString();
                }).length,
                lastUpdated: new Date().toISOString()
            };
            
            return stats;
        } catch (error) {
            console.error('[ToutiaoDO] Error getting stats:', error);
            return {
                totalTasks: 0,
                successfulTasks: 0,
                failedTasks: 0,
                pendingTasks: 0,
                processingTasks: 0,
                queueLength: 0,
                recentTasks: [],
                todayTasks: 0,
                lastUpdated: new Date().toISOString(),
                error: error.message
            };
        }
    }
}
