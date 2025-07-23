// 文件: src/zhihuServiceDO.js (新创建)
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
     * 获取并格式化知乎热点列表
     * @returns {Promise<string>} 格式化后的Markdown文本
     */
    async getZhihuHotListFormatted() {
        const combinedData = await this.zhihuService.getCombinedTopics();
        const topics = [...combinedData.hotTopics, ...combinedData.inspirationQuestions];

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
     * 执行回调的辅助函数
     */
    async performCallback(callbackInfo, finalContent) {
        try {
            if (!this.env.CHAT_ROOM_DO) {
                throw new Error("CHAT_ROOM_DO is not bound. Cannot perform callback.");
            }
            const chatroomId = this.env.CHAT_ROOM_DO.idFromName(callbackInfo.roomName);
            const chatroomStub = this.env.CHAT_ROOM_DO.get(chatroomId);
            await chatroomStub.updateMessage(callbackInfo.messageId, finalContent);
            this._log(`✅ 成功回调到房间 ${callbackInfo.roomName} 的消息 ${callbackInfo.messageId}`);
        } catch (callbackError) {
            this._log(`FATAL: 回调到房间 ${callbackInfo.roomName} 失败`, 'FATAL', callbackError);
        }
    }

    // 可选：为这个DO也添加一个fetch处理器，用于直接API调用或健康检查
    async fetch(request) {
        return new Response("ZhihuServiceDO is running.", { status: 200 });
    }
}