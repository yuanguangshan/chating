// 文件: src/InspirationDO.js (已全面修正)
import { DurableObject } from "cloudflare:workers";
import { InspirationService } from "./inspirationService.js";

const CACHE_KEY = "inspiration_cache_v1";
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5分钟缓存

export class InspirationDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.inspirationService = new InspirationService(env);
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this._log("🗄️ 存储初始化完成。");
  }

  _log(message, level = "INFO", data = null) {
    const logData = data ? JSON.stringify(data) : "";
    console.log(
      `[InspirationDO] [${new Date().toISOString()}] [${level}] ${message} ${logData}`
    );
  }

  async getOrFetchInspirations() {
    await this.initialize();
    const cached = await this.ctx.storage.get(CACHE_KEY);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
      this._log("✅ 从缓存中获取灵感数据。");
      return cached.data;
    }
    this._log("🔄 缓存失效或不存在，正在获取新的灵感数据...");
    try {
      const freshData = await this.inspirationService.getCombinedInspirations();
      if (freshData && freshData.length > 0) {
        await this.ctx.storage.put(CACHE_KEY, {
          data: freshData,
          timestamp: Date.now(),
        });
        this._log(`💾 已将 ${freshData.length} 条新灵感数据缓存。`);
      }
      return freshData;
    } catch (error) {
      this._log("❌ 获取新灵感数据失败", "ERROR", error);
      if (cached?.data) {
        this._log("⚠️ 返回旧的缓存数据作为备用。");
        return cached.data;
      }
      throw new Error("无法获取灵感数据，且无可用缓存。");
    }
  }

  // ✅ [核心修正] 更新为 fetch 回调方式
  async processAndCallback(task) {
    const { payload, callbackInfo } = task;
    let finalContent;
    try {
      finalContent = await this.getInspirationsForChat(payload.limit || 15);
    } catch (error) {
      this._log("在 processAndCallback 中获取灵感失败", "ERROR", error);
      finalContent = `> (❌ **灵感获取失败**: ${error.message})`;
    }

    // 使用新的、统一的 fetch 回调
    await this.performCallback(callbackInfo, finalContent);
  }

  // ✅ [新增] 与其他 DO 对齐的、健壮的回调函数
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
        `FATAL: 回调到房间 ${callbackInfo.roomName} 失败!`,
        "FATAL",
        callbackError
      );
    }
  }

  async getInspirationsForChat(limit = 15) {
    try {
      const inspirations = await this.getOrFetchInspirations();
      if (!inspirations || inspirations.length === 0)
        return "😔 抱歉，暂时没有获取到任何创作灵感。";
      let markdown = "🔥 **今日灵感速递 (Top 15)** 🔥\n\n---\n\n";
      inspirations.slice(0, limit).forEach((item, index) => {
        markdown += `${index + 1}. **[${item.source}]** ${item.title}\n`;
        markdown += `   - **分类**: ${item.category}\n`;
        markdown += `   - **热度**: ${item.hotValue}\n`;
        markdown += `   - [查看原文](${item.url})\n\n`;
      });
      return markdown;
    } catch (error) {
      this._log("生成聊天灵感时出错", "ERROR", error);
      return `💥 获取灵感时发生错误: ${error.message}`;
    }
  }

  // ✅ [核心修正] 修正 fetch 方法以处理内部任务
  async fetch(request) {
    const url = new URL(request.url);
    // ✅ [核心修正] 将 path 的定义提前，解决 ReferenceError
    const path = url.pathname;

    // 1. 优先处理来自 worker 的内部任务派发 (POST请求)
    if (request.method === "POST" && path === "/internal-task") {
      try {
        const task = await request.json();
        if (task.command && task.callbackInfo) {
          this._log(`收到内部任务: ${task.command}`, "INFO", task);
          this.ctx.waitUntil(this.processAndCallback(task));
          return new Response("Task accepted by InspirationDO", {
            status: 202,
          });
        }
      } catch (e) {
        this._log("解析内部任务POST请求失败", "WARN", e);
      }
    }

    // 2. 处理原有的公共 API 请求
    try {
      switch (
        path // 使用已定义的 path 变量
      ) {
        case "/api/inspirations":
        case "/inspirations":
          if (request.method === "GET") {
            const data = await this.getOrFetchInspirations();
            return new Response(
              JSON.stringify({ success: true, count: data.length, data: data }),
              {
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                },
              }
            );
          }
          return new Response("Method Not Allowed", { status: 405 });
        case "/health":
          return new Response(JSON.stringify({ status: "ok" }), {
            headers: { "Content-Type": "application/json" },
          });
        default:
          return new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      this._log(`处理请求 ${path} 失败`, "ERROR", error);
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
