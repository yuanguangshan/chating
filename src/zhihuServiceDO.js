// 文件: src/zhihuServiceDO.js (已修复)
// 职责: "知乎专家" - 专门处理知乎热点获取、文章生成等任务

import { DurableObject } from "cloudflare:workers";
import { ZhihuHotService } from './zhihuHotService.js';
// 我们需要调用AI来生成文章，所以也需要导入AI相关的函数
import { getGeminiChatAnswer } from './ai.js';

export class ZhihuServiceDO extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        // ZhihuHotService 是一个纯逻辑和API请求的辅助类
        this.zhihuService = new ZhihuHotService(env);
    }

    _log(message, level = 'INFO', data = null) {
        console.log(`[ZhihuServiceDO] [${new Date().toISOString()}] [${level}] ${message}`, data || '');
    }

    /**
     * 统一的任务处理与回调入口
     * @param {object} task - 从 worker 派发过来的完整任务对象
     */
    async processAndCallback(task) {
        const { command, payload, callbackInfo } = task;
        this._log(`收到知乎任务: ${command}`, { payload, callbackInfo });

        let finalContent;
        try {
            switch (command) {
                case 'zhihu_hot':
                    finalContent = await this.getZhihuHotListFormatted();
                    break;
                case 'zhihu_article':
                    finalContent = await this.generateZhihuArticle(payload.topic);
                    break;
                default:
                    finalContent = `> (❌ **未知知乎命令**: ${command})`;
            }
        } catch (error) {
            this._log(`处理知乎任务 ${command} 时发生错误`, 'ERROR', error);
            finalContent = `> (❌ **知乎任务处理失败**: ${error.message})`;
        }

        // 执行回调，将结果更新回聊天室
        await this.performCallback(callbackInfo, finalContent);
    }

    /**
     * ✅【已修复】获取并格式化知乎热点列表
     * 直接调用底层服务获取数据，而不是通过外部API
     * @returns {Promise<string>} 格式化后的Markdown文本
     */
    async getZhihuHotListFormatted() {
        // 并发获取热点和灵感
        const [hotTopics, inspirationQuestions] = await Promise.all([
            this.zhihuService.getHotTopicsForContent(10),
            this.zhihuService.getInspirationQuestionsForContent(5)
        ]);

        const topics = [...hotTopics, ...inspirationQuestions];

        if (!topics || topics.length === 0) {
            throw new Error('未能获取到知乎热点话题和灵感问题');
        }

        let responseText = "🔥 **知乎实时热点与灵感**\n\n";
        topics.forEach((topic, index) => {
            const topicNumber = index + 1;
            const hotValue = topic.hotValue || 'N/A';
            const excerpt = topic.excerpt || '暂无描述';
            
            if (topic.type === 'hot') {
                responseText += `### ${topicNumber}. 📈 ${topic.title}\n`;
                responseText += `**🔥 热度**: ${hotValue}\n`;
            } else {
                responseText += `### ${topicNumber}. 💡 ${topic.title}\n`;
            }
            responseText += `**摘要**: ${excerpt.length > 80 ? excerpt.substring(0, 80) + '...' : excerpt}\n`;
            responseText += `[🔗 查看原文](${topic.url})\n\n`;
        });

        responseText += "---\n";
        responseText += "### 🎮 **操作指南**\n";
        responseText += "- 发送 `/知乎文章 [序号]` 或 `/知乎文章 [关键词]` 生成文章。\n";
        responseText += "*(例如: `/知乎文章 1` 或 `/知乎文章 AI`)*";
        
        // 将话题数据暂存到DO的存储中，以便生成文章时使用
        await this.ctx.storage.put('last_zhihu_topics', topics);

        return responseText;
    }

    /**
     * 根据话题生成知乎风格文章
     * @param {string} topicInfo - 话题索引或关键词
     * @returns {Promise<string>} 生成的文章内容
     */
    async generateZhihuArticle(topicInfo) {
        const topics = await this.ctx.storage.get('last_zhihu_topics');
        if (!topics) {
            throw new Error("请先使用 `/知乎热点` 获取最新话题列表。");
        }

        let selectedTopic;
        if (/^\d+$/.test(topicInfo)) { // 按索引查找
            const index = parseInt(topicInfo) - 1;
            if (index >= 0 && index < topics.length) {
                selectedTopic = topics[index];
            }
        } else { // 按关键词查找
            const keyword = topicInfo.toLowerCase();
            selectedTopic = topics.find(t => t.title.toLowerCase().includes(keyword));
        }

        if (!selectedTopic) {
            throw new Error(`未找到匹配的话题: "${topicInfo}"`);
        }

        // 使用AI生成文章
        const prompt = this.zhihuService.generateContentPrompt(selectedTopic);
        const articleContent = await getGeminiChatAnswer(prompt, [], this.env);

        // 格式化最终输出
        return `🎯 **基于知乎话题生成的文章**\n\n` +
               `**话题**: ${selectedTopic.title}\n` +
               `**热度**: ${selectedTopic.hotValue}\n\n` +
               `---\n\n${articleContent}`;
    }

 /**
     * ✅【已修复】执行回调的辅助函数
     * 将原来的 RPC 调用改为标准的 fetch 请求，以避免通信歧义。
     */
    async performCallback(callbackInfo, finalContent) {
        try {
            if (!this.env.CHAT_ROOM_DO) {
                throw new Error("CHAT_ROOM_DO is not bound. Cannot perform callback.");
            }
            const chatroomId = this.env.CHAT_ROOM_DO.idFromName(callbackInfo.roomName);
            const chatroomStub = this.env.CHAT_ROOM_DO.get(chatroomId);

            // ✅ 使用 fetch 发送一个明确的 POST 请求到 ChatRoomDO 的一个特定API端点
            const response = await chatroomStub.fetch("https://do-internal/api/callback", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messageId: callbackInfo.messageId,
                    newContent: finalContent,
                    status: 'success' // 附带状态，让 ChatRoomDO 知道任务成功了
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Callback failed with status ${response.status}: ${errorText}`);
            }

            this._log(`✅ 成功回调到房间 ${callbackInfo.roomName} 的消息 ${callbackInfo.messageId}`);

        } catch (callbackError) {
            // 如果回调本身失败，我们无能为力，只能记录日志
            this._log(`FATAL: 回调到房间 ${callbackInfo.roomName} 失败`, 'FATAL', callbackError);
        }
    }

    /**
     * fetch处理器，用于处理来自 worker 的直接API请求 (例如来自管理面板)
     */
    async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // 来自管理面板的请求，获取组合数据
            if (path.includes('/api/zhihu/combined')) {
                const hotTopics = await this.zhihuService.getHotTopicsForContent(15);
                const inspirationQuestions = await this.zhihuService.getInspirationQuestionsForContent(15);
                const response = {
                    hotTopics,
                    inspirationQuestions,
                    timestamp: new Date().toISOString()
                };
                return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
            }
            // 来自管理面板的请求，生成文章
            if (path.includes('/api/zhihu/article')) {
                const { topicInfo, roomName } = await request.json();
                // 注意：这里我们直接调用AI生成，但没有回调到聊天室，因为这是管理面板的请求
                // 实际应用中可能需要更复杂的逻辑，比如返回任务ID
                const prompt = this.zhihuService.generateContentPrompt(topicInfo);
                const articleContent = await getGeminiChatAnswer(prompt, [], this.env);
                return new Response(JSON.stringify({ success: true, article: articleContent }), { headers: { 'Content-Type': 'application/json' } });
            }
             // 来自管理面板的请求，搜索话题
            if (path.includes('/api/zhihu/search')) {
                const { keyword } = await request.json();
                const topics = await this.zhihuService.generateRelatedTopics(keyword, 10);
                return new Response(JSON.stringify({ topics }), { headers: { 'Content-Type': 'application/json' } });
            }

            return new Response("ZhihuServiceDO is running.", { status: 200 });

        } catch (error) {
            this._log(`处理请求 ${path} 失败`, 'ERROR', error);
            return new Response(JSON.stringify({ success: false, error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
}
