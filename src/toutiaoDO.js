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
            default:
                return new Response('API Endpoint Not Found in ToutiaoDO', { status: 404 });
        }
    }
}
