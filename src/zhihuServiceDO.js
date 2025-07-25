// 文件: src/zhihuServiceDO.js (已修正 path is not defined 错误)
// 职责: "知乎专家" - 专门处理知乎热点获取、文章生成等任务

import { DurableObject } from "cloudflare:workers";
import { ZhihuHotService } from "./zhihuHotService.js";
import { getGeminiChatAnswer } from "./ai.js";

export class ZhihuServiceDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.zhihuService = new ZhihuHotService(env);
  }

  _log(message, level = "INFO", data = null) {
    console.log(
      `[ZhihuServiceDO] [${new Date().toISOString()}] [${level}] ${message}`,
      data || ""
    );
  }

  async processAndCallback(task) {
    const { command, payload, callbackInfo } = task;
    this._log(`收到知乎任务: ${command}`, { payload, callbackInfo });

    let finalContent;
    try {
      switch (command) {
        case "zhihu_hot":
          finalContent = await this.getZhihuHotListFormatted();
          break;
        case "zhihu_article":
          finalContent = await this.generateZhihuArticle(payload.content);
          break;
        default:
          finalContent = `> (❌ **未知知乎命令**: ${command})`;
      }
    } catch (error) {
      this._log(`处理知乎任务 ${command} 时发生错误`, "ERROR", error);
      finalContent = `> (❌ **知乎任务处理失败**: ${error.message})`;
    }

    await this.performCallback(callbackInfo, finalContent);
  }

  async getZhihuHotListFormatted() {
    const [hotTopics, inspirationQuestions] = await Promise.all([
      this.zhihuService.getHotTopicsForContent(10),
      this.zhihuService.getInspirationQuestionsForContent(5),
    ]);
    const topics = [...hotTopics, ...inspirationQuestions];
    if (!topics || topics.length === 0) {
      throw new Error("未能获取到知乎热点话题和灵感问题");
    }
    let responseText = "🔥 **知乎实时热点与灵感**\n\n";
    topics.forEach((topic, index) => {
      const topicNumber = index + 1;
      const hotValue = topic.hotValue || "N/A";
      const excerpt = topic.excerpt || "暂无描述";
      if (topic.type === "hot") {
        responseText += `### ${topicNumber}. 📈 ${topic.title}\n`;
        responseText += `**🔥 热度**: ${hotValue}\n`;
      } else {
        responseText += `### ${topicNumber}. 💡 ${topic.title}\n`;
      }
      responseText += `**摘要**: ${excerpt.length > 80 ? excerpt.substring(0, 80) + "..." : excerpt}\n`;
      responseText += `[🔗 查看原文](${topic.url})\n\n`;
    });
    responseText += "---\n";
    responseText += "### 🎮 **操作指南**\n";
    responseText +=
      "- 发送 `/知乎文章 [序号]` 或 `/知乎文章 [关键词]` 生成文章。\n";
    responseText += "*(例如: `/知乎文章 1` 或 `/知乎文章 AI`)*";
    await this.ctx.storage.put("last_zhihu_topics", topics);
    return responseText;
  }

  async generateZhihuArticle(topicInfo) {
    const topics = await this.ctx.storage.get("last_zhihu_topics");
    if (!topics) {
      throw new Error("请先使用 `/知乎热点` 获取最新话题列表。");
    }
    let selectedTopic;
    if (/^\d+$/.test(topicInfo)) {
      const index = parseInt(topicInfo) - 1;
      if (index >= 0 && index < topics.length) {
        selectedTopic = topics[index];
      }
    } else {
      const keyword = topicInfo.toLowerCase();
      selectedTopic = topics.find((t) =>
        t.title.toLowerCase().includes(keyword)
      );
    }
    if (!selectedTopic) {
      throw new Error(`未找到匹配的话题: "${topicInfo}"`);
    }
    const prompt = this.zhihuService.generateContentPrompt(selectedTopic);
    const articleContent = await getGeminiChatAnswer(prompt, [], this.env);
    return (
      `🎯 **基于知乎话题生成的文章**\n\n` +
      `**话题**: ${selectedTopic.title}\n` +
      `**热度**: ${selectedTopic.hotValue || "N/A"}\n\n` +
      `---\n\n${articleContent}`
    );
  }

  async performCallback(callbackInfo, finalContent) {
    try {
      if (!this.env.CHAT_ROOM_DO) {
        throw new Error("CHAT_ROOM_DO is not bound. Cannot perform callback.");
      }
      const chatroomId = this.env.CHAT_ROOM_DO.idFromName(
        callbackInfo.roomName
      );
      const chatroomStub = this.env.CHAT_ROOM_DO.get(chatroomId);

      const response = await chatroomStub.fetch(
        "https://do-internal/api/callback",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: callbackInfo.messageId,
            newContent: finalContent,
            status: "success",
          }),
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Callback failed with status ${response.status}: ${errorText}`
        );
      }
      this._log(
        `✅ 成功回调到房间 ${callbackInfo.roomName} 的消息 ${callbackInfo.messageId}`
      );
    } catch (callbackError) {
      this._log(
        `FATAL: 回调到房间 ${callbackInfo.roomName} 失败`,
        "FATAL",
        callbackError
      );
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    // ✅ [核心修正] 将 path 的定义提前，确保在整个方法中都可用
    const path = url.pathname;

    // 1. 优先处理来自 worker 的内部任务派发 (POST请求)
    if (request.method === "POST" && path === "/internal-task") {
      try {
        const task = await request.json();
        if (task.command && task.callbackInfo) {
          this._log(`收到内部任务: ${task.command}`, "INFO", task);
          this.ctx.waitUntil(this.processAndCallback(task));
          return new Response("Task accepted by ZhihuServiceDO", {
            status: 202,
          });
        }
      } catch (e) {
        this._log("POST请求不是内部任务，将尝试作为公共API处理", "DEBUG");
      }
    }

    // 2. 如果不是内部任务，则执行公共 API 路由逻辑
    try {
      if (path.includes("/api/zhihu/combined")) {
        const hotTopics = await this.zhihuService.getHotTopicsForContent(15);
        const inspirationQuestions =
          await this.zhihuService.getInspirationQuestionsForContent(15);
        const response = {
          hotTopics,
          inspirationQuestions,
          timestamp: new Date().toISOString(),
        };
        return new Response(JSON.stringify(response), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path.includes("/api/zhihu/article")) {
        const { topicInfo } = await request.json();
        const prompt = this.zhihuService.generateContentPrompt(topicInfo);
        const articleContent = await getGeminiChatAnswer(prompt, [], this.env);
        return new Response(
          JSON.stringify({ success: true, article: articleContent }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      if (path.includes("/api/zhihu/search")) {
        const { keyword } = await request.json();
        const topics = await this.zhihuService.generateRelatedTopics(
          keyword,
          10
        );
        return new Response(JSON.stringify({ topics }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(
        "ZhihuServiceDO is running. No matching API endpoint found for this request.",
        { status: 404 }
      );
    } catch (error) {
      this._log(`处理公共API请求 ${url.pathname} 失败`, "ERROR", error);
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
}
