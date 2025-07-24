// 文件: src/chatroom_do.js
// 职责: 纯粹的聊天室"前台接待" Durable Object

import { DurableObject } from "cloudflare:workers";
import { getGeminiChatAnswer, getKimiChatAnswer, getDeepSeekChatAnswer } from './ai.js'; // 确保ai.js中有这些导出

// 消息类型常量
const MSG_TYPE_CHAT = 'chat';
const MSG_TYPE_DELETE = 'delete';
const MSG_TYPE_ERROR = 'error';
const MSG_TYPE_WELCOME = 'welcome';
const MSG_TYPE_GEMINI_CHAT = 'gemini_chat';
const MSG_TYPE_DEEPSEEK_CHAT = 'deepseek_chat';
const MSG_TYPE_KIMI_CHAT = 'kimi_chat';
const MSG_TYPE_USER_JOIN = 'user_join';
const MSG_TYPE_USER_LEAVE = 'user_leave';
const MSG_TYPE_DEBUG_LOG = 'debug_log';
const MSG_TYPE_HEARTBEAT = 'heartbeat';
const MSG_TYPE_OFFER = 'offer';
const MSG_TYPE_ANSWER = 'answer';
const MSG_TYPE_CANDIDATE = 'candidate';
const MSG_TYPE_CALL_END = 'call_end';
const MSG_TYPE_USER_LIST_UPDATE = 'user_list_update';

// 存储键常量
const ALLOWED_USERS_KEY = 'allowed_users';
const MESSAGES_KEY = 'messages';

const JSON_HEADERS = {
  'Content-Type': 'application/json;charset=UTF-8',
  'Access-Control-Allow-Origin': '*'
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
    // 先把 roomName 置空，稍后在真正的会话初始化时再赋值
    this.roomName = undefined;

    this.debugLog("🏗️ DO 实例已创建。");

    // 增加一个强制的启动日志，以便我们在 tail log 中确认此代码已执行
    console.log(`[ChatRoomDO] CONSTRUCTOR FIRED! Room Name Initialized to: "${this.roomName}"`);

    this.debugLog("🏗️ DO 实例已创建或唤醒。");
    this.startHeartbeat();
  }

  // ============ 调试与心跳系统 ============
  debugLog(message, level = 'INFO', data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, id: crypto.randomUUID().substring(0, 8), data };
    this.debugLogs.push(logEntry);
    if (this.debugLogs.length > this.maxDebugLogs) this.debugLogs.shift();
    console.log(`[${timestamp}] [${level}] ${message}`, data || '');
    if (level !== 'HEARTBEAT') this.broadcastDebugLog(logEntry);
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
    const heartbeatMessage = JSON.stringify({ type: MSG_TYPE_HEARTBEAT, payload: { timestamp: Date.now() } });
    const now = Date.now();
    const timeout = 120000;
    const disconnected = [];

    this.sessions.forEach((session, sessionId) => {
      if (now - session.lastSeen > timeout) {
        disconnected.push(sessionId);
        return;
      }
      try {
        if (session.ws.readyState === WebSocket.OPEN) session.ws.send(heartbeatMessage);
        else if (session.ws.readyState !== WebSocket.CONNECTING) disconnected.push(sessionId);
      } catch {
        disconnected.push(sessionId);
      }
    });

    disconnected.forEach(id => this.cleanupSession(id, { code: 1011, reason: 'Heartbeat/Timeout' }));
  }

  // ============ 状态管理 ============
  async initialize() {
    if (this.isInitialized) return;
    const allowed = await this.ctx.storage.get(ALLOWED_USERS_KEY);
    if (allowed === undefined) {
      // 没有 Key，表示“不配置白名单”，默认开放所有人
      this.allowedUsers = undefined;
      this.debugLog(`ℹ️ 房间白名单未配置，默认开放所有用户加入。`);
    } else {
      // 只要存储里有 key，就启动白名单功能
      this.allowedUsers = new Set(allowed);
      this.debugLog(`📁 已加载白名单. Allowed Users: ${this.allowedUsers.size}`);
    }
    this.messages = null;
    this.isInitialized = true;
  }

  async saveAllowedUsers() {
    if (this.allowedUsers === undefined) return;
    await this.ctx.storage.put(ALLOWED_USERS_KEY, Array.from(this.allowedUsers));
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

  // ============ RPC 方法 ============
  async cronPost(text, secret) {
    if (this.env.CRON_SECRET && secret !== this.env.CRON_SECRET) {
      this.debugLog("定时任务：未授权的尝试！", 'ERROR');
      return;
    }
    await this.initialize();
    await this.loadMessages();
    const message = { id: crypto.randomUUID(), username: "机器人小助手", timestamp: Date.now(), text, type: 'text' };
    await this.addAndBroadcastMessage(message);
  }

  async broadcastSystemMessage(payload, secret) {
    if (this.env.CRON_SECRET && secret !== this.env.CRON_SECRET) return;
    await this.initialize();
    this.debugLog(`📢 收到系统消息: ${payload.message}`, payload.level || 'INFO', payload.data);
    this.broadcast({ type: MSG_TYPE_DEBUG_LOG, payload: { ...payload, timestamp: new Date().toISOString(), id: crypto.randomUUID().substring(0, 8) } });
  }

  // ============ 主入口 fetch ============
  async fetch(request) {
    const url = new URL(request.url);
    this.debugLog(`🚘 服务端入站请求: ${request.method} ${url.pathname}`);
    await this.initialize();

    // 回调入口
    if (url.pathname === '/api/callback' && request.method === 'POST') {
      try {
        const { messageId, newContent, status, metadata } = await request.json();
        if (status === 'success') {
          await this.updateMessageAndBroadcastAndBroadcast(messageId, newContent, metadata);
        } else {
          await this.updateMessageAndBroadcastAndBroadcast(messageId, `> (❌ 任务执行失败: ${newContent})`);
        }
        return new Response('Callback processed.', { status: 200 });
      } catch (e) {
        this.debugLog(`❌ 处理内部回调失败: ${e.message}`, 'ERROR', e);
        return new Response('Bad callback request.', { status: 400 });
      }
    }

    // WebSocket 升级
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request, url);
    }
    // API 请求
    if (url.pathname.startsWith('/api/')) {
      return this.handleApiRequest(request);
    }
    // HTML 请求标记，让外层 worker 返回页面
    if (request.method === "GET") {
      return new Response(null, { headers: { "X-DO-Request-HTML": "true" } });
    }
    return new Response("Endpoint not found", { status: 404 });
  }

  // ============ WebSocket 升级 & 会话初始化 ============
  async handleWebSocketUpgrade(request, url) {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.handleSessionInitialization(server, url);
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSessionInitialization(ws, url) {
    // **在这里** 拿到房间名并保存
    const roomName = url.pathname.slice(1).split('/')[0];
    this.roomName = roomName;
    this.debugLog(`📌 房间名已设置为: "${this.roomName}"`);

    const username = decodeURIComponent(url.searchParams.get("username") || "Anonymous");
    let reason = null;
    // 只有在显式配置了白名单时，才做过滤
    if (this.allowedUsers !== undefined && !this.allowedUsers.has(username)) {
      reason = "您不在本房间的白名单中，无法加入。";
    }

    if (reason) {
      ws.send(JSON.stringify({ type: 'auth_failed', payload: { message: reason } }));
      this.ctx.waitUntil(new Promise(r => setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.close(1008, reason);
        r();
      }, 500)));
      return;
    }

    // 真正进到会话逻辑
    await this.handleWebSocketSession(ws, url, username);
  }

  async handleWebSocketSession(ws, url, username) {
    const sessionId = crypto.randomUUID();
    const session = { id: sessionId, username, ws, joinTime: Date.now(), lastSeen: Date.now() };
    this.sessions.set(sessionId, session);
    ws.sessionId = sessionId;

    this.debugLog(`✅ 接受用户连接: 👦 ${username} (Session: ${sessionId}). Total: ${this.sessions.size}`);
    await this.loadMessages();

    const initialHistory = this.messages.slice(-20);
    const hasMoreHistory = this.messages.length > 20;

    ws.send(JSON.stringify({
      type: MSG_TYPE_WELCOME,
      payload: {
        message: `👏 欢迎 ${username} 加入聊天室!`,
        sessionId,
        history: initialHistory,
        hasMoreHistory,
        userCount: this.sessions.size
      }
    }));

    this.broadcast({ type: MSG_TYPE_USER_JOIN, payload: { username, userCount: this.sessions.size } }, sessionId);
    this.broadcastUserListUpdate();

    ws.addEventListener('message', ev => this.webSocketMessage(ws, ev.data));
    ws.addEventListener('close', ev => this.webSocketClose(ws, ev.code, ev.reason, ev.wasClean));
    ws.addEventListener('error', err => this.webSocketError(ws, err));
  }

  // ============ WebSocket 消息 & 清理 ============
  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws.sessionId);
    if (!session) return ws.close(1011, "Session not found.");
    session.lastSeen = Date.now();

    let data;
    try { data = JSON.parse(message); }
    catch (e) {
      this.debugLog(`❌ 解析WebSocket消息失败: ${e.message}`, 'ERROR');
      return;
    }

    // 命令优先
    if (data.type === MSG_TYPE_CHAT && data.payload?.text?.startsWith('/')) {
      return this.handleUserCommand(session, data.payload);
    }

    // 其他消息类型
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
        this.debugLog(`⚠️ 未处理的消息类型: ${data.type}`, 'WARN', data);
    }
  }

  webSocketClose(ws, code, reason) {
    this.cleanupSession(ws.sessionId, { code, reason });
  }

  webSocketError(ws, error) {
    this.debugLog(`💥 WebSocket 错误: ${error.message}`, 'ERROR');
    this.cleanupSession(ws.sessionId, { code: 1011, reason: 'WebSocket error' });
  }

  cleanupSession(sessionId, details) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.debugLog(`🔌 用户断开连接: 👦 ${session.username}. 原因: ${details.reason || ''} (${details.code}). Total: ${this.sessions.size}`);
    this.broadcast({ type: MSG_TYPE_USER_LEAVE, payload: { username: session.username, userCount: this.sessions.size } });
    this.broadcastUserListUpdate();
  }

  // ============ 用户命令处理 ============
  async handleUserCommand(session, payload) {
    const text = payload.text.trim();
    let command, taskPayload;

    if (text.startsWith('/头条')) {
      command = 'toutiao_article';
      taskPayload = { content: text.substring(3).trim() };
    } else if (text.startsWith('/知乎热点')) {
      command = 'zhihu_hot';
      taskPayload = {};
    } else if (text.startsWith('/知乎文章')) {
      command = 'zhihu_article';
      taskPayload = { topic: text.substring(5).trim() };
    } else if (text.startsWith('/新闻')) {
      command = 'news_article';
      taskPayload = { topic: text.substring(3).trim() };
    }

    if (!command) {
      return this.handleChatMessage(session, payload);
    }

    this.debugLog(`⚡ 收到用户命令: ${command}`, 'INFO', { user: session.username, payload: taskPayload });

    const thinkingMessage = {
      id: crypto.randomUUID(),
      username: session.username,
      timestamp: Date.now(),
      text: `${text}\n\n> (⏳ 正在处理中，请稍候...)`,
      type: 'text'
    };
    await this.addAndBroadcastMessage(thinkingMessage);

    // **关键：此处使用最新在 handleSessionInitialization 里得到的 this.roomName**
    const task = {
      command,
      payload: taskPayload,
      callbackInfo: {
        roomName: this.roomName,
        messageId: thinkingMessage.id,
        username: session.username
      }
    };

    console.log(`[ChatRoomDO] 委派任务到 Worker，roomName="${this.roomName}" command=${command}`);
    this.ctx.waitUntil(this.delegateTaskToWorker(task));
  }

  async delegateTaskToWorker(task) {
    try {
      const resp = await this.env.SELF.fetch('https://internal-worker/api/internal-task-handler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task)
      });
      if (!resp.ok) throw new Error(`Worker 返回 ${resp.status}`);
      this.debugLog(`✅ 任务已成功委托给Worker: ${task.command}`);
    } catch (e) {
      this.debugLog(`❌ 委托任务给Worker失败: ${task.command}`, 'ERROR', e);
      const errText = `> (❌ 任务委托失败: ${e.message})`;
      await this.updateMessageAndBroadcastAndBroadcast(task.callbackInfo.messageId, errText);
    }
  }

  // ============ 聊天、删除、AI etc. ============
  async handleChatMessage(session, payload) {
    const message = {
      id: crypto.randomUUID(),
      username: session.username,
      timestamp: Date.now(),
      ...payload
    };
    await this.addAndBroadcastMessage(message);
  }

  async handleDeleteMessageRequest(session, payload) {
    await this.loadMessages();
    const idx = this.messages.findIndex(m => m.id === payload.id);
    if (idx === -1) return;
    const m = this.messages[idx];
    if (m.username === session.username) {
      this.messages.splice(idx, 1);
      await this.saveMessages();
      this.broadcast({ type: MSG_TYPE_DELETE, payload: { id: payload.id } });
      this.debugLog(`🗑️ 用户 ${session.username} 删除了消息 ${payload.id}`);
    }
  }

  // 通用 AI Handler
  async handleGenericAiChat(session, payload, aiName, aiFn) {
    const thinking = {
      id: crypto.randomUUID(),
      username: aiName,
      timestamp: Date.now(),
      text: "思考中...",
      type: 'text'
    };
    await this.addAndBroadcastMessage(thinking);
    try {
      const history = this.messages.slice(-10);
      const answer = await aiFn(payload.text, history, this.env);
      await this.updateMessageAndBroadcastAndBroadcast(thinking.id, answer);
    } catch (e) {
      const errText = `抱歉，我在调用 ${aiName} 时遇到了问题: ${e.message}`;
      await this.updateMessageAndBroadcastAndBroadcast(thinking.id, errText);
      this.debugLog(`❌ 调用 ${aiName} 失败`, 'ERROR', e);
    }
  }
  async handleGeminiChatMessage(s,p) { return this.handleGenericAiChat(s,p,"Gemini",getGeminiChatAnswer); }
  async handleDeepSeekChatMessage(s,p){ return this.handleGenericAiChat(s,p,"DeepSeek",getDeepSeekChatAnswer); }
  async handleKimiChatMessage(s,p)    { return this.handleGenericAiChat(s,p,"Kimi",getKimiChatAnswer); }

  // ============ 广播 & 存储 ============
  async updateMessageAndBroadcastAndBroadcast(messageId, newText, meta={}) {
    await this.loadMessages();
    const i = this.messages.findIndex(m => m.id === messageId);
    if (i !== -1) {
      this.messages[i].text = newText;
      this.messages[i].timestamp = Date.now();
      Object.assign(this.messages[i], meta);
      await this.saveMessages();
      this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[i] });
      this.debugLog(`✅ 消息 ${messageId} 已更新并广播`);
    } else {
      this.debugLog(`⚠️ 尝试更新一个不存在的消息: ${messageId}`, 'WARN');
    }
  }

  async addAndBroadcastMessage(message) {
    await this.loadMessages();
    this.messages.push(message);
    await this.saveMessages();
    this.broadcast({ type: MSG_TYPE_CHAT, payload: message });
  }

  broadcast(msg, exceptId=null) {
    const s = JSON.stringify(msg);
    this.sessions.forEach((session, sid) => {
      if (sid !== exceptId && session.ws.readyState === WebSocket.OPEN) {
        try { session.ws.send(s); }
        catch (e) { this.debugLog(`💥 广播失败: ${session.username}`, 'ERROR', e); }
      }
    });
  }

  broadcastUserListUpdate() {
    const users = Array.from(this.sessions.values()).map(s => ({ id: s.id, username: s.username }));
    this.broadcast({ type: MSG_TYPE_USER_LIST_UPDATE, payload: { users, userCount: users.length } });
  }

  forwardRtcSignal(type, fromSession, payload) {
    if (!payload.target) return;
    const tgt = Array.from(this.sessions.values()).find(s => s.username === payload.target);
    if (tgt && tgt.ws.readyState === WebSocket.OPEN) {
      tgt.ws.send(JSON.stringify({ type, payload: { ...payload, from: fromSession.username } }));
    }
  }

  // ============ HTTP API 处理 ============
  async handleApiRequest(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const secret = url.searchParams.get('secret');
    const isAdmin = this.env.ADMIN_SECRET && secret === this.env.ADMIN_SECRET;

    if (path.endsWith('/users/list')) {
      return new Response(JSON.stringify({ users: Array.from(this.allowedUsers||[]), active: this.allowedUsers!==undefined }), { headers: JSON_HEADERS });
    }
    if (path.endsWith('/users/add') && request.method==='POST' && isAdmin) {
      const { username } = await request.json();
      if (this.allowedUsers===undefined) this.allowedUsers = new Set();
      this.allowedUsers.add(username);
      await this.saveAllowedUsers();
      return new Response(JSON.stringify({ success: true }), { headers: JSON_HEADERS });
    }
    if (path.endsWith('/users/remove') && request.method==='POST' && isAdmin) {
      const { username } = await request.json();
      if (this.allowedUsers) this.allowedUsers.delete(username);
      await this.saveAllowedUsers();
      return new Response(JSON.stringify({ success: true }), { headers: JSON_HEADERS });
    }
    if (path.endsWith('/messages/history')) {
      await this.loadMessages();
      const beforeId = url.searchParams.get('beforeId');
      let end = this.messages.length;
      if (beforeId) {
        const idx = this.messages.findIndex(m=>m.id===beforeId);
        if (idx!==-1) end = idx;
      }
      const slice = this.messages.slice(Math.max(0, end-20), end);
      return new Response(JSON.stringify({ messages: slice, hasMore: Math.max(0,end-20)>0 }), { headers: JSON_HEADERS });
    }
    if (path.endsWith('/reset-room') && isAdmin) {
      await this.ctx.storage.deleteAll();
      this.messages = [];
      this.sessions.clear();
      this.allowedUsers = undefined;
      this.debugLog("🔄 房间已成功重置");
      return new Response("房间已重置", { status: 200 });
    }
    if (path.endsWith('/room/status')) {
      await this.loadMessages();
      const status = {
        roomName: this.roomName,
        messageCount: this.messages.length,
        userCount: this.sessions.size,
        hasWhitelist: this.allowedUsers!==undefined,
        userList: this.allowedUsers?Array.from(this.allowedUsers):[]
      };
      return new Response(JSON.stringify(status), { headers: JSON_HEADERS });
    }

    return new Response("API endpoint not found or unauthorized", { status: 404 });
  }
}