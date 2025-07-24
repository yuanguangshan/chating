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
        } else {
            finalContent = `> (❌ **[后台任务] 文章处理失败**: ${result.error || '未知错误'})`;
            this._log(`后台任务 ${processorTask.id} 处理失败`, 'ERROR', result);
        }

        // 将结果发送到指定的房间
        const callbackInfo = {
            roomName: roomName,
            // 对于后台任务，我们没有原始消息ID，所以创建一个新的
            messageId: `notification-${processorTask.id}`
        };
        await this.performCallback(callbackInfo, finalContent, true); // true表示这是一个新消息
    }

    // [现有方法] 处理来自聊天室的实时任务
    async processAndCallback(task) {
        const { command, payload, callbackInfo } = task;
        this._log(`收到实时任务: ${command}`, 'INFO', { payload, callbackInfo });

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
            } else {
                throw new Error(result.error || '未知处理错误');
            }

        } catch (error) {
            this._log(`处理头条任务 ${command} 时发生错误`, 'ERROR', { message: error.message, stack: error.stack });
            finalContent = `> (❌ **头条任务处理失败**: ${error.message})`;
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


// [最终修正] 替换掉文件末尾的 fetch 方法

async fetch(request) {
    // 1. [健壮性] 使用 try...catch 包裹整个 fetch，防止 DO 崩溃
    try {
        // 2. [复用] 确保在处理任何请求前，DO都已初始化
        await this.initialize();

        const url = new URL(request.url);
        const pathname = url.pathname;

        // 3. [路由] 区分实时任务、管理面板API和内部回调
        
        // 3.1 处理来自聊天室的实时任务 (您现有的逻辑)
        if (pathname === '/api/process') {
            const task = await request.json();
            // 异步处理，不阻塞对聊天室的响应
            this.ctx.waitUntil(this.processAndCallback(task));
            return new Response(JSON.stringify({ success: true, message: 'Task received by ToutiaoDO' }), { status: 202 });
        }

        // 3.2 处理来自管理面板的 API (需要密钥验证)
        if (pathname.startsWith('/api/toutiao/') || pathname === '/api/inspirations/generate') {
            const secret = url.searchParams.get('secret');
            if (secret !== this.env.ADMIN_SECRET) {
                return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            // 使用 switch 处理所有管理 API
            switch (true) {
                // ✅ [新] 处理文章生成请求，调用您写好的 handleGenerateFromInspiration 方法
                case pathname === '/api/inspirations/generate' && request.method === 'POST':
                    return this.handleGenerateFromInspiration(request);

                // ✅ [新] 返回任务队列，数据源是 taskProcessor
                case pathname === '/api/toutiao/queue':
                    const queue = await this.taskProcessor.getQueue();
                    return new Response(JSON.stringify({
                        success: true,
                        length: queue.length,
                        tasks: queue
                    }), { headers: { 'Content-Type': 'application/json' } });

                // ✅ [新] 返回统计数据，数据源是 taskProcessor
                case pathname === '/api/toutiao/stats':
                    const stats = await this.taskProcessor.getStats();
                    return new Response(JSON.stringify(stats), { headers: { 'Content-Type': 'application/json' } });

                // ✅ [新] 返回已完成的结果，数据源是 taskProcessor (增加健壮性)
                case pathname === '/api/toutiao/results':
                    const results = await this.taskProcessor.getResults();
                    // 健壮的排序逻辑
                    results.sort((a, b) => {
                        const timeA = a && a.completedAt ? new Date(a.completedAt).getTime() : 0;
                        const timeB = b && b.completedAt ? new Date(b.completedAt).getTime() : 0;
                        if (isNaN(timeA) || isNaN(timeB)) return 0;
                        return timeB - timeA;
                    });
                    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });

                // ✅ [新] 清空队列，调用 taskProcessor
                case pathname === '/api/toutiao/clearQueue' && request.method === 'POST':
                    await this.taskProcessor.clearQueue();
                    return new Response(JSON.stringify({ success: true, message: 'Queue cleared' }), { headers: { 'Content-Type': 'application/json' } });

                // ✅ [新] 触发队列处理，调用 taskProcessor
                case pathname === '/api/toutiao/processQueue' && request.method === 'POST':
                    // 异步触发，不等待处理完成
                    this.ctx.waitUntil(this.taskProcessor.processQueue());
                    this._log('[API] Manual queue processing triggered.');
                    return new Response(JSON.stringify({ success: true, message: 'Queue processing triggered' }), { headers: { 'Content-Type': 'application/json' } });

                // ✅ [新] 查询单个任务状态，调用 taskProcessor
                case pathname.startsWith('/api/toutiao/status/'):
                    const taskId = pathname.split('/').pop();
                    const task = await this.taskProcessor.getTaskStatus(taskId);
                    if (task) {
                        return new Response(JSON.stringify({ success: true, task }), { headers: { 'Content-Type': 'application/json' } });
                    }
                    return new Response(JSON.stringify({ success: false, message: 'Task not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

                default:
                    return new Response(JSON.stringify({ success: false, message: 'API Endpoint Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
            }
        }

        // 4. [默认] 如果没有匹配的路由，返回 404
        return new Response('Not Found', { status: 404 });

    } catch (err) {
        // 5. [健壮性] 捕获所有未处理的异常，返回标准 JSON 错误
        this._log(`FATAL ERROR in fetch: ${err.stack}`, 'FATAL');
        return new Response(JSON.stringify({
            success: false,
            message: 'Durable Object encountered an internal error.',
            error: err.message
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}


}
