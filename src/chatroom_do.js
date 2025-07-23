// 文件: src/chatroom_do.js (最终完整版)
// 职责: 纯粹的聊天室"前台接待" Durable Object

import { DurableObject } from "cloudflare:workers";
import { getGeminiChatAnswer, getKimiChatAnswer, getDeepSeekChatAnswer } from './ai.js'; // 确保ai.js中有这些导出

// 消息类型常量
const MSG_TYPE_CHAT = 'chat';
const MSG_TYPE_DELETE = 'delete';
const MSG_TYPE_ERROR = 'error';
const MSG_TYPE_WELCOME = 'welcome';
const MSG_TYPE_GEMINI_CHAT = 'gemini';
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
        this.roomName = this.ctx.id.name;

        this.debugLog("🏗️ DO 实例已创建。");
        this.startHeartbeat();
    }

    // ============ 调试与心跳系统 (保持不变) ============
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
        const disconnectedSessions = [];

        this.sessions.forEach((session, sessionId) => {
            if (now - session.lastSeen > timeout) {
                disconnectedSessions.push(sessionId);
                return;
            }
            try {
                if (session.ws.readyState === WebSocket.OPEN) session.ws.send(heartbeatMessage);
                else if (session.ws.readyState !== WebSocket.CONNECTING) disconnectedSessions.push(sessionId);
            } catch (e) {
                disconnectedSessions.push(sessionId);
            }
        });

        if (disconnectedSessions.length > 0) {
            disconnectedSessions.forEach(sessionId => this.cleanupSession(sessionId, { code: 1011, reason: 'Heartbeat/Timeout failed' }));
        }
    }

    // ============ 状态管理 (保持不变) ============
    async initialize() {
        if (this.isInitialized) return;
        const allowed = await this.ctx.storage.get(ALLOWED_USERS_KEY);
        if (allowed === undefined) {
            this.allowedUsers = undefined;
            this.debugLog(`ℹ️ 房间白名单未激活。此房间不允许访问。`);
        } else {
            this.allowedUsers = new Set(allowed || []);
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
            this.debugLog(`📨 消息历史已加载: ${this.messages.length}条`);
        }
    }

    async saveMessages() {
        if (this.messages === null) return;
        await this.ctx.storage.put(MESSAGES_KEY, this.messages);
    }

    // ============ RPC 方法 (供外部调用) ============
    // ✅ [恢复] 恢复用于定时任务等功能的RPC方法
    async cronPost(text, secret) {
        if (this.env.CRON_SECRET && secret !== this.env.CRON_SECRET) {
            this.debugLog("定时任务：未授权的尝试！", 'ERROR');
            return;
        }
        await this.initialize();
        if (this.allowedUsers === undefined) return;
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

    // ============ 内部方法 (由 fetch 或其他内部逻辑调用) ============
    async updateMessageAndBroadcast(messageId, newContent, metadata = {}) {
        await this.initialize();
        await this.loadMessages();
        const messageIndex = this.messages.findIndex(m => m.id === messageId);
        if (messageIndex !== -1) {
            this.messages[messageIndex].text = newContent;
            this.messages[messageIndex].timestamp = Date.now();
            Object.assign(this.messages[messageIndex], metadata);
            await this.saveMessages();
            this.broadcast({ type: MSG_TYPE_CHAT, payload: this.messages[messageIndex] });
            this.debugLog(`✅ 消息 ${messageId} 已通过回调更新`);
        } else {
            this.debugLog(`⚠️ 尝试更新一个不存在的消息: ${messageId}`, 'WARN');
        }
    }

    // ============ 主要入口点 ============
    async fetch(request) {
        const url = new URL(request.url);
        this.debugLog(`🚘 服务端入站请求: ${request.method} ${url.pathname}`);
        await this.initialize();

        if (url.pathname === '/api/internal-callback' && request.method === 'POST') {
            try {
                const { messageId, newContent, status, metadata } = await request.json();
                if (status === 'success') {
                    await this.updateMessageAndBroadcast(messageId, newContent, metadata);
                } else {
                    await this.updateMessageAndBroadcast(messageId, `> (❌ 任务执行失败: ${newContent})`);
                }
                return new Response('Callback processed.', { status: 200 });
            } catch (e) {
                this.debugLog(`❌ 处理内部回调失败: ${e.message}`, 'ERROR', e);
                return new Response('Bad callback request.', { status: 400 });
            }
        }

        if (request.headers.get("Upgrade") === "websocket") {
            return this.handleWebSocketUpgrade(request, url);
        }
        if (url.pathname.startsWith('/api/')) {
            return this.handleApiRequest(request);
        }
        if (request.method === "GET") {
            return new Response(null, { headers: { "X-DO-Request-HTML": "true" } });
        }
        return new Response("Endpoint not found", { status: 404 });
    }

    // ============ WebSocket 会话处理 (保持不变) ============
    async handleWebSocketUpgrade(request, url) {
        const { 0: client, 1: server } = new WebSocketPair();
        this.ctx.acceptWebSocket(server);
        this.handleSessionInitialization(server, url);
        return new Response(null, { status: 101, webSocket: client });
    }

    async handleSessionInitialization(ws, url) {
        const username = decodeURIComponent(url.searchParams.get("username") || "Anonymous");
        await this.initialize();
        let reason = null;

        if (this.allowedUsers === undefined) {
            reason = "房间不存在或未激活，请联系管理员。";
        } else if (!this.allowedUsers.has(username)) {
            reason = "您不在本房间的白名单中，无法加入。";
        }

        if (reason) {
            ws.send(JSON.stringify({ type: 'auth_failed', payload: { message: reason } }));
            this.ctx.waitUntil(new Promise(resolve => setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) ws.close(1008, reason);
                resolve();
            }, 1000)));
            return;
        }

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
    }

    // ============ WebSocket 事件处理器 ============
    async webSocketMessage(ws, message) {
        const session = this.sessions.get(ws.sessionId);
        if (!session) {
            ws.close(1011, "Session not found.");
            return;
        }
        session.lastSeen = Date.now();

        try {
            const data = JSON.parse(message);
            // 优先处理需要委托给 Worker 的 `/` 命令
            if (data.type === MSG_TYPE_CHAT && data.payload?.text && data.payload.text.startsWith('/')) {
                await this.handleUserCommand(session, data.payload);
            } else {
                // 处理其他所有类型的消息
                switch (data.type) {
                    case MSG_TYPE_CHAT:
                        await this.handleChatMessage(session, data.payload);
                        break;
                    // ✅ [恢复] 恢复对AI聊天的处理
                    case MSG_TYPE_GEMINI_CHAT:
                        await this.handleGeminiChatMessage(session, data.payload);
                        break;
                    case MSG_TYPE_DEEPSEEK_CHAT:
                        await this.handleDeepSeekChatMessage(session, data.payload);
                        break;
                    case MSG_TYPE_KIMI_CHAT:
                        await this.handleKimiChatMessage(session, data.payload);
                        break;
                    case MSG_TYPE_DELETE:
                        await this.handleDeleteMessageRequest(session, data.payload);
                        break;
                    case MSG_TYPE_HEARTBEAT:
                        break;
                    case MSG_TYPE_OFFER:
                    case MSG_TYPE_ANSWER:
                    case MSG_TYPE_CANDIDATE:
                    case MSG_TYPE_CALL_END:
                        this.forwardRtcSignal(data.type, session, data.payload);
                        break;
                    default:
                        this.debugLog(`⚠️ 未处理的消息类型: ${data.type}`, 'WARN', data);
                }
            }
        } catch (e) {
            this.debugLog(`❌ 解析WebSocket消息失败: ${e.message}`, 'ERROR', { error: e.stack });
        }
    }

    webSocketClose(ws, code, reason, wasClean) {
        this.cleanupSession(ws.sessionId, { code, reason, wasClean });
    }

    webSocketError(ws, error) {
        this.debugLog(`💥 WebSocket 错误: ${error.message}`, 'ERROR', error);
        this.cleanupSession(ws.sessionId, { code: 1011, reason: 'WebSocket error' });
    }

    cleanupSession(sessionId, details) {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.sessions.delete(sessionId);
            this.debugLog(`🔌 用户断开连接: 👦 ${session.username}. 原因: ${details.reason} (${details.code}). Total: ${this.sessions.size}`);
            this.broadcast({ type: MSG_TYPE_USER_LEAVE, payload: { username: session.username, userCount: this.sessions.size } });
            this.broadcastUserListUpdate();
        }
    }

    // ============ 核心业务逻辑 ============
    async handleUserCommand(session, data) {
        const text = data.text.trim();
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
            // 如果不是一个已知的 `/` 命令，则当作普通聊天处理
            await this.handleChatMessage(session, data);
            return;
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

        this.ctx.waitUntil(this.delegateTaskToWorker({
            command: command,
            payload: taskPayload,
            callbackInfo: {
                roomName: this.roomName,
                messageId: thinkingMessage.id,
                username: session.username
            }
        }));
    }

    async delegateTaskToWorker(task) {
        try {
            const response = await this.env.SELF.fetch('https://internal-worker/api/internal-task-handler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(task)
            });
            if (!response.ok) {
                throw new Error(`Worker returned status ${response.status}`);
            }
            this.debugLog(`✅ 任务已成功委托给Worker: ${task.command}`);
        } catch (error) {
            this.debugLog(`❌ 委托任务给Worker失败: ${task.command}`, 'ERROR', error);
            const errorText = `> (❌ 任务委托失败: ${error.message})`;
            await this.updateMessageAndBroadcast(task.callbackInfo.messageId, errorText);
        }
    }

    async handleChatMessage(session, payload) {
        const message = {
            id: crypto.randomUUID(),
            username: session.username,
            timestamp: Date.now(),
            ...payload
        };
        await this.addAndBroadcastMessage(message);
    }

    // ✅ [修复] 实现缺失的 handleDeleteMessageRequest 函数
    async handleDeleteMessageRequest(session, payload) {
        await this.loadMessages();
        const messageId = payload.id;
        const messageIndex = this.messages.findIndex(m => m.id === messageId);

        if (messageIndex === -1) return;

        const messageToDelete = this.messages[messageIndex];
        // 只有消息所有者或管理员(如果实现了)才能删除
        if (messageToDelete.username === session.username) {
            this.messages.splice(messageIndex, 1);
            await this.saveMessages();
            this.broadcast({ type: MSG_TYPE_DELETE, payload: { id: messageId } });
            this.debugLog(`🗑️ 用户 ${session.username} 删除了消息 ${messageId}`);
        }
    }

    // ✅ [恢复] 恢复AI聊天处理函数
    async handleGenericAiChat(session, payload, aiName, aiFunction) {
        const thinkingMessage = {
            id: crypto.randomUUID(),
            username: aiName,
            timestamp: Date.now(),
            text: "思考中...",
            type: 'text'
        };
        await this.addAndBroadcastMessage(thinkingMessage);

        try {
            const history = this.messages.slice(-10);
            const answer = await aiFunction(payload.text, history, this.env);
            await this.updateMessageAndBroadcast(thinkingMessage.id, answer);
        } catch (e) {
            const errorText = `抱歉，我在调用 ${aiName} 时遇到了问题: ${e.message}`;
            await this.updateMessageAndBroadcast(thinkingMessage.id, errorText);
            this.debugLog(`❌ 调用 ${aiName} 失败`, 'ERROR', e);
        }
    }

    async handleGeminiChatMessage(session, payload) {
        await this.handleGenericAiChat(session, payload, "Gemini", getGeminiChatAnswer);
    }

    async handleDeepSeekChatMessage(session, payload) {
        await this.handleGenericAiChat(session, payload, "DeepSeek", getDeepSeekChatAnswer);
    }

    async handleKimiChatMessage(session, payload) {
        await this.handleGenericAiChat(session, payload, "Kimi", getKimiChatAnswer);
    }


    // ============ 辅助方法 (保持不变) ============
    async addAndBroadcastMessage(message) {
        await this.loadMessages();
        this.messages.push(message);
        await this.saveMessages();
        this.broadcast({ type: MSG_TYPE_CHAT, payload: message });
    }

    broadcast(message, exceptSessionId = null) {
        const messageString = JSON.stringify(message);
        this.sessions.forEach((session, sessionId) => {
            if (sessionId !== exceptSessionId && session.ws.readyState === WebSocket.OPEN) {
                try {
                    session.ws.send(messageString);
                } catch (e) {
                    this.debugLog(`💥 广播失败: 👦 ${session.username}`, 'ERROR', e);
                }
            }
        });
    }

    broadcastUserListUpdate() {
        const users = Array.from(this.sessions.values()).map(s => ({ id: s.id, username: s.username }));
        this.broadcast({ type: MSG_TYPE_USER_LIST_UPDATE, payload: { users, userCount: users.length } });
    }

    forwardRtcSignal(type, fromSession, payload) {
        if (!payload.target) return;
        let targetSession = Array.from(this.sessions.values()).find(s => s.username === payload.target);
        if (targetSession && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(JSON.stringify({ type, payload: { ...payload, from: fromSession.username } }));
        }
    }

    // ============ API 请求处理 (保持不变) ============
    async handleApiRequest(request) {
        const url = new URL(request.url);
        const path = url.pathname;
        const secret = url.searchParams.get('secret');
        const isAdmin = this.env.ADMIN_SECRET && secret === this.env.ADMIN_SECRET;

        if (path.endsWith('/users/list')) {
            return new Response(JSON.stringify({ users: Array.from(this.allowedUsers || []), active: this.allowedUsers !== undefined }), { headers: JSON_HEADERS });
        }
        if (path.endsWith('/users/add') && request.method === 'POST' && isAdmin) {
            const { username } = await request.json();
            if (this.allowedUsers === undefined) this.allowedUsers = new Set();
            this.allowedUsers.add(username);
            await this.saveAllowedUsers();
            return new Response(JSON.stringify({ success: true }), { headers: JSON_HEADERS });
        }
        if (path.endsWith('/users/remove') && request.method === 'POST' && isAdmin) {
            const { username } = await request.json();
            if (this.allowedUsers) this.allowedUsers.delete(username);
            await this.saveAllowedUsers();
            return new Response(JSON.stringify({ success: true }), { headers: JSON_HEADERS });
        }
        if (path.endsWith('/messages/history')) {
            await this.loadMessages();
            const beforeId = url.searchParams.get('beforeId');
            let endIndex = this.messages.length;
            if (beforeId) {
                const index = this.messages.findIndex(m => m.id === beforeId);
                if (index !== -1) endIndex = index;
            }
            const historySlice = this.messages.slice(Math.max(0, endIndex - 20), endIndex);
            return new Response(JSON.stringify({ messages: historySlice, hasMore: Math.max(0, endIndex - 20) > 0 }), { headers: JSON_HEADERS });
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
                hasWhitelist: this.allowedUsers !== undefined,
                userList: this.allowedUsers ? Array.from(this.allowedUsers) : []
            };
            return new Response(JSON.stringify(status), { headers: JSON_HEADERS });
        }

        return new Response("API endpoint not found or unauthorized", { status: 404 });
    }
}
