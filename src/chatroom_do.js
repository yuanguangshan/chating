// 文件: src/chatroom_do.js (最终修正版)
// 职责: 纯粹的聊天室"前台接待" Durable Object

import { DurableObject } from "cloudflare:workers";
import {
  getGeminiChatAnswer,
  getKimiChatAnswer,
  getDeepSeekChatAnswer,
} from "./ai.js";

// (所有常量保持不变)
const MSG_TYPE_CHAT = "chat";
const MSG_TYPE_DELETE = "delete";
const MSG_TYPE_ERROR = "error";
const MSG_TYPE_WELCOME = "welcome";
const MSG_TYPE_GEMINI_CHAT = "gemini_chat";
const MSG_TYPE_DEEPSEEK_CHAT = "deepseek_chat";
const MSG_TYPE_KIMI_CHAT = "kimi_chat";
const MSG_TYPE_USER_JOIN = "user_join";
const MSG_TYPE_USER_LEAVE = "user_leave";
const MSG_TYPE_DEBUG_LOG = "debug_log";
const MSG_TYPE_HEARTBEAT = "heartbeat";
const MSG_TYPE_OFFER = "offer";
const MSG_TYPE_ANSWER = "answer";
const MSG_TYPE_CANDIDATE = "candidate";
const MSG_TYPE_CALL_END = "call_end";
const MSG_TYPE_USER_LIST_UPDATE = "user_list_update";
const ALLOWED_USERS_KEY = "allowed_users";
const MESSAGES_KEY = "messages";
const JSON_HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  "Access-Control-Allow-Origin": "*",
};

export class HibernatingChating2 extends DurableObject {
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
    this.allowedUsers = undefined;

    // ✅ [核心修正] 在构造函数中立即、正确地设置 roomName
    // 这是最可靠的方式，确保任何类型的请求都能访问到正确的房间名
    //this.roomName = this.state.id.name;

    // ✅ [最终验证标记]
    console.log(
      `[ChatRoomDO] DEPLOY-SUCCESS-MARKER-V3! Room Name is: "${this.roomName}"`
    );

    this.debugLog("🏗️ DO 实例已创建或唤醒。");
    this.startHeartbeat();
  }

  // ============ 调试与心跳系统 (保持不变   ) ============
  debugLog(message, level = "INFO", data = null) {
    const timestamp = new Date().toISOString();
    // 使用正确的 this.roomName 来记录日志
    const logMessage = `[ChatRoomDO:${this.roomName}] ${message}`;
    const logEntry = {
      timestamp,
      level,
      message: logMessage,
      id: crypto.randomUUID().substring(0, 8),
      data,
    };
    this.debugLogs.push(logEntry);
    if (this.debugLogs.length > this.maxDebugLogs) this.debugLogs.shift();
    console.log(`[${timestamp}] [${level}] ${logMessage}`, data || "");
    if (level !== "HEARTBEAT") this.broadcastDebugLog(logEntry);
  }

  broadcastDebugLog(logEntry) {
    this.broadcast({ type: MSG_TYPE_DEBUG_LOG, payload: logEntry });
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 30000);
  }

  sendHeartbeat() {
    if (this.sessions.size === 0) return;
    const heartbeatMessage = JSON.stringify({
      type: MSG_TYPE_HEARTBEAT,
      payload: { timestamp: Date.now() },
    });
    const now = Date.now();
    const timeout = 120000;
    const disconnected = [];

    this.sessions.forEach((session, sessionId) => {
      if (now - session.lastSeen > timeout) {
        disconnected.push(sessionId);
        return;
      }
      try {
        if (session.ws.readyState === WebSocket.OPEN)
          session.ws.send(heartbeatMessage);
        else if (session.ws.readyState !== WebSocket.CONNECTING)
          disconnected.push(sessionId);
      } catch {
        disconnected.push(sessionId);
      }
    });

    disconnected.forEach((id) =>
      this.cleanupSession(id, { code: 1011, reason: "Heartbeat/Timeout" })
    );
  }

  // ============ 状态管理 (保持不变) ============
  async initialize() {
    if (this.isInitialized) return;
    const allowed = await this.ctx.storage.get(ALLOWED_USERS_KEY);
    if (allowed === undefined) {
      this.allowedUsers = undefined;
      this.debugLog(`ℹ️ 房间白名单未配置，默认开放所有用户加入。`);
    } else {
      this.allowedUsers = new Set(allowed);
      this.debugLog(
        `📁 已加载白名单. Allowed Users: ${this.allowedUsers.size}`
      );
    }
    this.messages = null;
    this.isInitialized = true;
    this.roomName = this.state.id.name;
  }

  async saveAllowedUsers() {
    if (this.allowedUsers === undefined) return;
    await this.ctx.storage.put(
      ALLOWED_USERS_KEY,
      Array.from(this.allowedUsers)
    );
  }

  async loadMessages() {
    if (this.messages === null) {
      this.messages = (await this.ctx.storage.get(MESSAGES_KEY)) || [];
      this.debugLog(`📨 消息历史已加载: ${this.messages.length} 条`);
    }
  }

  async saveMessages() {
    if (this.messages === null) return;
    await this.ctx.storage.put(MESSAGES_KEY, this.messages);
  }

  // ============ RPC 方法 (保持不变) ============
  async cronPost(text, secret) {
    if (this.env.CRON_SECRET && secret !== this.env.CRON_SECRET) {
      this.debugLog("定时任务：未授权的尝试！", "ERROR");
      return;
    }
    await this.initialize();
    await this.loadMessages();
    const message = {
      id: crypto.randomUUID(),
      username: "机器人小助手",
      timestamp: Date.now(),
      text,
      type: "text",
    };
    await this.addAndBroadcastMessage(message);
  }

  async broadcastSystemMessage(payload, secret) {
    if (this.env.CRON_SECRET && secret !== this.env.CRON_SECRET) return;
    await this.initialize();
    this.debugLog(
      `📢 收到系统消息: ${payload.message}`,
      payload.level || "INFO",
      payload.data
    );
    this.broadcast({
      type: MSG_TYPE_DEBUG_LOG,
      payload: {
        ...payload,
        timestamp: new Date().toISOString(),
        id: crypto.randomUUID().substring(0, 8),
      },
    });
  }

  // ============ 主入口 fetch (核心修改) ============
  async fetch(request) {
    const url = new URL(request.url);
    this.debugLog(`🚘 服务端入站请求: ${request.method} ${url.pathname}`);
    await this.initialize();

    // 从路径中解析房间名
    const roomNameMatch = url.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
    if (roomNameMatch && roomNameMatch[1]) {
      this.roomName = roomNameMatch[1];
    } else if (!this.roomName) {
      // 如果没有从路径中解析到，并且尚未设置，则使用默认值或从其他地方获取
      // 对于内部回调，路径可能是 /api/callback，所以 roomName 不会变
      this.roomName = this.roomName || "test"; // 保证有个值
    }

    this.debugLog(
      `🚘 服务端入站请求: ${request.method} ${url.pathname} on room "${this.roomName}"`
    );

    // ✅ [新增路由] 处理来自后台任务的【新】系统消息
    if (
      url.pathname === "/api/post-system-message" &&
      request.method === "POST"
    ) {
      return this.handlePostSystemMessage(request);
    }

    // [现有路由] 处理来自聊天室任务的【更新】回调
    if (url.pathname === "/api/callback" && request.method === "POST") {
      try {
        const { messageId, newContent, status, metadata } =
          await request.json();
        if (status === "success") {
          await this.updateMessageAndBroadcast(messageId, newContent, metadata);
        } else {
          await this.updateMessageAndBroadcast(
            messageId,
            `> (❌ 任务执行失败: ${newContent})`
          );
        }
        return new Response("Callback processed.", { status: 200 });
      } catch (e) {
        this.debugLog(`❌ 处理内部回调失败: ${e.message}`, "ERROR", e);
        return new Response("Bad callback request.", { status: 400 });
      }
    }

    // WebSocket 升级
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request, url);
    }
    // API 请求
    if (url.pathname.startsWith("/api/")) {
      return this.handleApiRequest(request);
    }
    // HTML 请求标记，让外层 worker 返回页面
    if (request.method === "GET") {
      return new Response(null, { headers: { "X-DO-Request-HTML": "true" } });
    }
    return new Response("Endpoint not found", { status: 404 });
  }

  // ✅ [新增方法] 专门处理来自后台服务（如ToutiaoDO）的新消息发布请求
  async handlePostSystemMessage(request) {
    try {
      const { content } = await request.json();
      if (!content) {
        this.debugLog("❌ 系统消息请求缺少 content", "ERROR");
        return new Response("Missing content", { status: 400 });
      }

      this.debugLog("📩 收到来自后台服务的系统消息", "INFO", { content });

      // 复用您现有的 addAndBroadcastMessage 方法来创建、保存和广播消息
      // 这确保了逻辑的统一性
      const message = {
        id: crypto.randomUUID(),
        username: "System", // 使用 "System" 作为系统消息的发送者
        timestamp: Date.now(),
        text: content,
        type: "text", // 保持和普通聊天消息一致的结构
      };
      await this.addAndBroadcastMessage(message);

      return new Response(
        JSON.stringify({ success: true, messageId: message.id }),
        { status: 200, headers: JSON_HEADERS }
      );
    } catch (error) {
      this.debugLog(`💥 处理系统消息时发生严重错误`, "ERROR", error);
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: JSON_HEADERS }
      );
    }
  }

  // ============ WebSocket 升级 & 会话初始化 (保持不变) ============
  async handleWebSocketUpgrade(request, url) {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.handleSessionInitialization(server, url);
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSessionInitialization(ws, url) {
    // 这部分逻辑现在只对WebSocket连接生效，这是正确的
    this.debugLog(`📌 WebSocket 连接初始化，房间名是: "${this.roomName}"`);

    const username = decodeURIComponent(
      url.searchParams.get("username") || "Anonymous"
    );
    let reason = null;
    if (this.allowedUsers !== undefined && !this.allowedUsers.has(username)) {
      reason = "您不在本房间的白名单中，无法加入。";
    }

    if (reason) {
      ws.send(
        JSON.stringify({ type: "auth_failed", payload: { message: reason } })
      );
      this.ctx.waitUntil(
        new Promise((r) =>
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) ws.close(1008, reason);
            r();
          }, 500)
        )
      );
      return;
    }

    await this.handleWebSocketSession(ws, url, username);
  }

  async handleWebSocketSession(ws, url, username) {
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      username,
      ws,
      joinTime: Date.now(),
      lastSeen: Date.now(),
    };
    this.sessions.set(sessionId, session);
    ws.sessionId = sessionId;

    this.debugLog(
      `✅ 接受用户连接: 👦 ${username} (Session: ${sessionId}). Total: ${this.sessions.size}`
    );
    await this.loadMessages();

    const initialHistory = this.messages.slice(-20);
    const hasMoreHistory = this.messages.length > 20;

    ws.send(
      JSON.stringify({
        type: MSG_TYPE_WELCOME,
        payload: {
          message: `👏 欢迎 ${username} 加入聊天室!`,
          sessionId,
          history: initialHistory,
          hasMoreHistory,
          userCount: this.sessions.size,
        },
      })
    );

    this.broadcast(
      {
        type: MSG_TYPE_USER_JOIN,
        payload: { username, userCount: this.sessions.size },
      },
      sessionId
    );
    this.broadcastUserListUpdate();

    ws.addEventListener("message", (ev) => this.webSocketMessage(ws, ev.data));
    ws.addEventListener("close", (ev) =>
      this.webSocketClose(ws, ev.code, ev.reason, ev.wasClean)
    );
    ws.addEventListener("error", (err) => this.webSocketError(ws, err));
  }

  // ============ WebSocket 消息 & 清理 (保持不变) ============
  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws.sessionId);
    if (!session) return ws.close(1011, "Session not found.");
    session.lastSeen = Date.now();

    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      this.debugLog(`❌ 解析WebSocket消息失败: ${e.message}`, "ERROR");
      return;
    }

    if (data.type === MSG_TYPE_CHAT && data.payload?.text?.startsWith("/")) {
      return this.handleUserCommand(session, data.payload);
    }

    switch (data.type) {
      case MSG_TYPE_CHAT:
        return this.handleChatMessage(session, data.payload);
      case MSG_TYPE_GEMINI_CHAT:
        return this.handleGeminiChatMessage(session, data.payload);
      case MSG_TYPE_DEEPSEEK_CHAT:
        return this.handleDeepSeekChatMessage(session, data.payload);
      case MSG_TYPE_KIMI_CHAT:
        return this.handleKimiChatMessage(session, data.payload);
      case MSG_TYPE_DELETE:
        return this.handleDeleteMessageRequest(session, data.payload);
      case MSG_TYPE_HEARTBEAT:
        return;
      case MSG_TYPE_OFFER:
      case MSG_TYPE_ANSWER:
      case MSG_TYPE_CANDIDATE:
      case MSG_TYPE_CALL_END:
        return this.forwardRtcSignal(data.type, session, data.payload);
      default:
        this.debugLog(`⚠️ 未处理的消息类型: ${data.type}`, "WARN", data);
    }
  }

  webSocketClose(ws, code, reason) {
    this.cleanupSession(ws.sessionId, { code, reason });
  }

  webSocketError(ws, error) {
    this.debugLog(`💥 WebSocket 错误: ${error.message}`, "ERROR");
    this.cleanupSession(ws.sessionId, {
      code: 1011,
      reason: "WebSocket error",
    });
  }

  cleanupSession(sessionId, details) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.debugLog(
      `🔌 用户断开连接: 👦 ${session.username}. 原因: ${details.reason || ""} (${details.code}). Total: ${this.sessions.size}`
    );
    this.broadcast({
      type: MSG_TYPE_USER_LEAVE,
      payload: { username: session.username, userCount: this.sessions.size },
    });
    this.broadcastUserListUpdate();
  }

  // ============ 用户命令处理 (保持不变) ============
  async handleUserCommand(session, payload) {
    const text = payload.text.trim();
    let command, taskPayload;

    if (text.startsWith("/新闻") || text.startsWith("/灵感")) {
      command = "inspiration";
      taskPayload = {};
    } else if (text.startsWith("/头条")) {
      command = "toutiao_article";
      taskPayload = { content: text.substring(3).trim() };
    } else if (text.startsWith("/知乎文章")) {
      command = "zhihu_article";
      taskPayload = { topic: text.substring(5).trim() };
    } else if (text.startsWith("/知乎")) {
      command = "zhihu_hot";
      taskPayload = {};
    }

    if (!command) {
      return this.handleChatMessage(session, payload);
    }

    this.debugLog(`⚡ 收到用户命令: ${command}`, "INFO", {
      user: session.username,
      payload: taskPayload,
    });

    const thinkingMessage = {
      id: crypto.randomUUID(),
      username: session.username,
      timestamp: Date.now(),
      text: `${text}\n\n> (⏳ 正在处理中，请稍候...)`,
      type: "text",
    };
    await this.addAndBroadcastMessage(thinkingMessage);

    const task = {
      command,
      payload: taskPayload,
      callbackInfo: {
        roomName: this.roomName,
        messageId: thinkingMessage.id,
        username: session.username,
      },
    };

    console.log(
      `[ChatRoomDO] 委派任务到 Worker，roomName="${this.roomName}" command=${command}`
    );
    this.ctx.waitUntil(this.delegateTaskToWorker(task));
  }

  async delegateTaskToWorker(task) {
    try {
      const resp = await this.env.SELF.fetch(
        "https://internal-worker/api/internal-task-handler",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(task),
        }
      );
      if (!resp.ok) throw new Error(`Worker 返回 ${resp.status}`);
      this.debugLog(`✅ 任务已成功委托给Worker: ${task.command}`);
    } catch (e) {
      this.debugLog(`❌ 委托任务给Worker失败: ${task.command}`, "ERROR", e);
      const errText = `> (❌ 任务委托失败: ${e.message})`;
      await this.updateMessageAndBroadcast(
        task.callbackInfo.messageId,
        errText
      );
    }
  }

  // ============ 聊天、删除、AI etc. (保持不变) ============
  async handleChatMessage(session, payload) {
    const message = {
      id: crypto.randomUUID(),
      username: session.username,
      timestamp: Date.now(),
      ...payload,
    };
    await this.addAndBroadcastMessage(message);
  }

  async handleDeleteMessageRequest(session, payload) {
    await this.loadMessages();
    const idx = this.messages.findIndex((m) => m.id === payload.id);
    if (idx === -1) return;
    const m = this.messages[idx];
    if (m.username === session.username) {
      this.messages.splice(idx, 1);
      await this.saveMessages();
      this.broadcast({ type: MSG_TYPE_DELETE, payload: { id: payload.id } });
      this.debugLog(`🗑️ 用户 ${session.username} 删除了消息 ${payload.id}`);
    }
  }

  async handleGenericAiChat(session, payload, aiName, aiFn) {
    const thinking = {
      id: crypto.randomUUID(),
      username: aiName,
      timestamp: Date.now(),
      text: "思考中...",
      type: "text",
    };
    await this.addAndBroadcastMessage(thinking);
    try {
      const history = this.messages.slice(-10);
      const answer = await aiFn(payload.text, history, this.env);
      await this.updateMessageAndBroadcast(thinking.id, answer);
    } catch (e) {
      const errText = `抱歉，我在调用 ${aiName} 时遇到了问题: ${e.message}`;
      await this.updateMessageAndBroadcast(thinking.id, errText);
      this.debugLog(`❌ 调用 ${aiName} 失败`, "ERROR", e);
    }
  }
  async handleGeminiChatMessage(s, p) {
    return this.handleGenericAiChat(s, p, "Gemini", getGeminiChatAnswer);
  }
  async handleDeepSeekChatMessage(s, p) {
    return this.handleGenericAiChat(s, p, "DeepSeek", getDeepSeekChatAnswer);
  }
  async handleKimiChatMessage(s, p) {
    return this.handleGenericAiChat(s, p, "Kimi", getKimiChatAnswer);
  }

  // ============ 广播 & 存储 (重命名一个函数以避免混淆) ============
  async updateMessageAndBroadcast(messageId, newText, meta = {}) {
    await this.loadMessages();
    const i = this.messages.findIndex((m) => m.id === messageId);
    if (i !== -1) {
      this.messages[i].text = newText;
      this.messages[i].timestamp = Date.now();
      Object.assign(this.messages[i], meta);
      await this.saveMessages();
      this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[i] });
      this.debugLog(`✅ 消息 ${messageId} 已更新并广播`);
    } else {
      this.debugLog(`⚠️ 尝试更新一个不存在的消息: ${messageId}`, "WARN");
    }
  }

  async addAndBroadcastMessage(message) {
    await this.loadMessages();
    this.messages.push(message);
    await this.saveMessages();
    this.broadcast({ type: MSG_TYPE_CHAT, payload: message });
  }

  broadcast(msg, exceptId = null) {
    const s = JSON.stringify(msg);
    this.sessions.forEach((session, sid) => {
      if (sid !== exceptId && session.ws.readyState === WebSocket.OPEN) {
        try {
          session.ws.send(s);
        } catch (e) {
          this.debugLog(`💥 广播失败: ${session.username}`, "ERROR", e);
        }
      }
    });
  }

  broadcastUserListUpdate() {
    const users = Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      username: s.username,
    }));
    this.broadcast({
      type: MSG_TYPE_USER_LIST_UPDATE,
      payload: { users, userCount: users.length },
    });
  }

  forwardRtcSignal(type, fromSession, payload) {
    if (!payload.target) return;
    const tgt = Array.from(this.sessions.values()).find(
      (s) => s.username === payload.target
    );
    if (tgt && tgt.ws.readyState === WebSocket.OPEN) {
      tgt.ws.send(
        JSON.stringify({
          type,
          payload: { ...payload, from: fromSession.username },
        })
      );
    }
  }

  // ============ HTTP API 处理 (保持不变) ============
  async handleApiRequest(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const secret = url.searchParams.get("secret");
    const isAdmin = this.env.ADMIN_SECRET && secret === this.env.ADMIN_SECRET;

    if (path.endsWith("/users/list")) {
      return new Response(
        JSON.stringify({
          users: Array.from(this.allowedUsers || []),
          active: this.allowedUsers !== undefined,
        }),
        { headers: JSON_HEADERS }
      );
    }
    if (path.endsWith("/users/add") && request.method === "POST" && isAdmin) {
      const { username } = await request.json();
      if (this.allowedUsers === undefined) this.allowedUsers = new Set();
      this.allowedUsers.add(username);
      await this.saveAllowedUsers();
      return new Response(JSON.stringify({ success: true }), {
        headers: JSON_HEADERS,
      });
    }
    if (
      path.endsWith("/users/remove") &&
      request.method === "POST" &&
      isAdmin
    ) {
      const { username } = await request.json();
      if (this.allowedUsers) this.allowedUsers.delete(username);
      await this.saveAllowedUsers();
      return new Response(JSON.stringify({ success: true }), {
        headers: JSON_HEADERS,
      });
    }
    if (path.endsWith("/messages/history")) {
      await this.loadMessages();
      const beforeId = url.searchParams.get("beforeId");
      let end = this.messages.length;
      if (beforeId) {
        const idx = this.messages.findIndex((m) => m.id === beforeId);
        if (idx !== -1) end = idx;
      }
      const slice = this.messages.slice(Math.max(0, end - 20), end);
      return new Response(
        JSON.stringify({ messages: slice, hasMore: Math.max(0, end - 20) > 0 }),
        { headers: JSON_HEADERS }
      );
    }
    if (path.endsWith("/reset-room") && isAdmin) {
      await this.ctx.storage.deleteAll();
      this.messages = [];
      this.sessions.clear();
      this.allowedUsers = undefined;
      this.debugLog("🔄 房间已成功重置");
      return new Response("房间已重置", { status: 200 });
    }
    if (path.endsWith("/room/status")) {
      await this.loadMessages();
      const status = {
        roomName: this.roomName,
        messageCount: this.messages.length,
        userCount: this.sessions.size,
        hasWhitelist: this.allowedUsers !== undefined,
        userList: this.allowedUsers ? Array.from(this.allowedUsers) : [],
      };
      return new Response(JSON.stringify(status), { headers: JSON_HEADERS });
    }

    return new Response("API endpoint not found or unauthorized", {
      status: 404,
    });
  }
}
