// 文件: src/toutiaoDO.js (已在您的最新版本上全面适配新服务)

import { DurableObject } from "cloudflare:workers";
// ✅ [修正] 不再需要直接调用 getGeminiChatAnswer
// import { getGeminiChatAnswer } from './ai.js'; 
// ✅ [保留] 您已正确导入新的任务处理器
import { ToutiaoTaskProcessor } from './toutiaoService.js';

export class ToutiaoServiceDO2 extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        // ✅ [核心修正] 属性重命名，以匹配新的服务类
        this.taskProcessor = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        this._log('正在初始化头条任务处理器...');
        // ✅ [核心修正] 实例化新的 ToutiaoTaskProcessor，它负责所有复杂逻辑
        // 它需要 env 和一个 logger (我们用 console)
        this.taskProcessor = new ToutiaoTaskProcessor(this.env, console);
        this.initialized = true;
        this._log('头条任务处理器已初始化');
    }

    _log(message, level = 'INFO', data = null) {
        const logData = data ? JSON.stringify(data) : '';
        console.log(`[ToutiaoDO] [${new Date().toISOString()}] [${level}] ${message} ${logData}`);
    }

    // ✅ [核心修正] 重写整个任务处理逻辑，以调用新的服务
    async processAndCallback(task) {
        const { command, payload, callbackInfo } = task;
        this._log(`收到实时任务: ${command}`, 'INFO', { payload, callbackInfo });

        let finalContent;
        try {
            await this.initialize();

            // 1. 准备一个符合 ToutiaoTaskProcessor 要求的任务对象
            const processorTask = {
                id: callbackInfo.messageId,
                text: payload.content,
                username: callbackInfo.username,
            };

            // 2. 将所有复杂工作委托给 taskProcessor
            const result = await this.taskProcessor.processTask(processorTask);

            // 3. 根据处理结果构建回调消息
            if (result.success) {
                // 从成功的结果中提取信息
                // 注意: 路径为 result.publishResult.data.data.pgc_id
                const articleUrl = `https://www.toutiao.com/article/${result.publishResult.data.data.pgc_id}/`;
                finalContent = `✅ **头条文章已发布**\n\n` +
                               `### ${result.title}\n\n` +
                               `> ${result.summary}\n\n` +
                               `[🔗 点击查看文章](${articleUrl})`;
                this._log(`任务 ${callbackInfo.messageId} 处理成功`, 'INFO', result);
            } else {
                // 从失败的结果中构建错误消息
                throw new Error(result.error || '未知处理错误');
            }

        } catch (error) {
            this._log(`处理头条任务 ${command} 时发生错误`, 'ERROR', { message: error.message, stack: error.stack });
            finalContent = `> (❌ **头条任务处理失败**: ${error.message})`;
        }

        // ✅ [保留] 调用您已修正好的、基于 fetch 的回调方法
        await this.performCallback(callbackInfo, finalContent);
    }

    /**
     * ✅ [保留] 您的回调函数已是最新最稳健的版本，无需修改！
     * 使用 fetch 向 ChatRoomDO 发送回调请求。
     */
    async performCallback(callbackInfo, finalContent) {
        try {
            if (!this.env.CHAT_ROOM_DO) {
                throw new Error("CHAT_ROOM_DO is not bound. Cannot perform callback.");
            }
            const chatroomId = this.env.CHAT_ROOM_DO.idFromName(callbackInfo.roomName);
            const chatroomStub = this.env.CHAT_ROOM_DO.get(chatroomId);

            const response = await chatroomStub.fetch("https://do-internal/api/callback", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messageId: callbackInfo.messageId,
                    newContent: finalContent,
                    status: 'success'
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Callback failed with status ${response.status}: ${errorText}`);
            }
            this._log(`✅ 成功回调到房间 ${callbackInfo.roomName} 的消息 ${callbackInfo.messageId}`);

        } catch (callbackError) {
            this._log(`FATAL: 回调到房间 ${callbackInfo.roomName} 失败! 用户 ${callbackInfo.username} 将不会看到消息 ${callbackInfo.messageId} 的更新。`, 'FATAL', callbackError);
        }
    }

    // ✅ [保留] 您的 fetch 路由逻辑已是最新版本，无需修改！
    async fetch(request) {
        const url = new URL(request.url);
        const method = request.method;

        if (method === 'POST' && url.pathname === '/internal-task') {
            const task = await request.json();
            this._log('收到内部任务: ' + task.command, 'INFO', task);
            this.ctx.waitUntil(this.processAndCallback(task));
            return new Response('Task accepted by ToutiaoDO', { status: 202 });
        }

        switch (url.pathname) {
            case '/api/toutiao/status':
                await this.initialize(); // 确保在检查状态前已初始化
                return new Response(JSON.stringify({ status: 'ok', initialized: this.initialized }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            default:
                return new Response('API Endpoint Not Found', { status: 404 });
        }
    }
}
