// 文件: src/worker.js (重构优化版)
// 职责: "办公室经理" - 路由外部请求，派发内部任务

// --- Polyfill for npm packages that expect 'global' ---
globalThis.global = globalThis;

import { HibernatingChating2 } from './chatroom_do.js';
import { ToutiaoServiceDO2 } from './toutiaoDO.js';
import { ZhihuServiceDO } from './zhihuServiceDO.js';
import { AuthServiceDO2 } from './authServiceDO.js';
import { InspirationDO } from './InspirationDO.js'; // 【新增】导入 InspirationDO
import html from '../public/index.html';
import managementHtml from '../public/management.html';
import { taskMap } from './autoTasks.js';
import {
    getDeepSeekExplanation,
    getGeminiExplanation,
    getGeminiImageDescription,
    getKimiExplanation,
    getKimiImageDescription
} from './ai.js';
import {MSG_TYPE_GEMINI_CHAT } from './constants.js';

// Export Durable Object classes for Cloudflare platform
export { HibernatingChating2, ToutiaoServiceDO2, AuthServiceDO2, InspirationDO ,ZhihuServiceDO}; // 【新增】导出 InspirationDO

// --- CORS Headers ---
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-control-allow-methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Filename',
    'Access-Control-Max-Age': '86400',
};

// =================================================================
// ==               主 Worker 入口点 (fetch handler)              ==
// =================================================================

export default {
    async fetch(request, env, ctx) {
        try {
            // Handle CORS preflight requests
            if (request.method === 'OPTIONS') {
                return handleOptions(request);
            }

            const url = new URL(request.url);
            const pathname = url.pathname;

            // --- 路由 1: 内部任务处理器 (核心重构部分) ---
            // This is the new endpoint for DOs to delegate tasks to the worker.
            if (pathname === '/api/internal-task-handler') {
                if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
                const task = await request.json();
                ctx.waitUntil(dispatchInternalTask(task, env));
                return new Response('Task accepted', { status: 202 });
            }

            // --- 路由 2: 全局独立API (不与特定房间DO强相关) ---
            if (pathname === '/upload') {
                return handleUpload(request, env);
            }
            if (pathname === '/ai-explain') {
                return handleAiExplain(request, env);
            }
            if (pathname === '/ai-describe-image') {
                return handleAiDescribeImage(request, env);
            }

            // --- 路由 3: 静态页面与资源 ---
            if (pathname === '/management') {
                return serveHtmlWithEnv(managementHtml, env, 'management');
            }
            if (pathname === '/favicon.ico') {
                return new Response(null, { status: 302, headers: { 'Location': 'https://pic.want.biz/favicon.svg' } });
            }

            // --- 路由 4: 转发到特定Durable Object ---
            // This handles WebSocket upgrades, room-specific APIs, and serving the main chat page.
            const pathParts = pathname.slice(1).split('/');
            const roomNameFromPath = pathParts[0];

            if (roomNameFromPath) {
                // 【新增】将 /api/inspirations 请求直接路由到 InspirationDO
                if (pathname === '/api/inspirations' || pathname === '/inspirations') {
                    if (!env.INSPIRATION_DO) throw new Error("Durable Object 'INSPIRATION_DO' is not bound.");
                    const doId = env.INSPIRATION_DO.idFromName("global");
                    const stub = env.INSPIRATION_DO.get(doId);
                    return stub.fetch(request);
                }
                
                // 【修改】将管理面板API请求路由到 TOUTIAO_SERVICE_DO
                if (pathname.startsWith('/api/toutiao/')) {
                    if (!env.TOUTIAO_SERVICE_DO) throw new Error("Durable Object 'TOUTIAO_SERVICE_DO' is not bound.");
                    const doId = env.TOUTIAO_SERVICE_DO.idFromName("management");
                    const stub = env.TOUTIAO_SERVICE_DO.get(doId);
                    return stub.fetch(request);
                }
               
                if (pathname.startsWith('/api/zhihu/')) {
                    if (!env.ZHIHU_SERVICE_DO) throw new Error("Durable Object 'ZHIHU_SERVICE_DO' is not bound.");
                    const doId = env.ZHIHU_SERVICE_DO.idFromName("global"); // 使用一个固定的ID
                    const stub = env.ZHIHU_SERVICE_DO.get(doId);
                    return stub.fetch(request); // 将请求直接转发给DO的fetch处理器
                }
                // 【新增】处理房间状态API请求
                if (pathname.startsWith('/api/room/status')) {
                    const roomName = url.searchParams.get('roomName');
                    if (!roomName) {
                        return new Response('roomName parameter is required', { status: 400 });
                    }
                    if (!env.CHAT_ROOM_DO) throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.");
                    const doId = env.CHAT_ROOM_DO.idFromName(roomName);
                    const stub = env.CHAT_ROOM_DO.get(doId);
                    return stub.fetch(request);
                }
                
                if (!env.CHAT_ROOM_DO) throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.");
                const doId = env.CHAT_ROOM_DO.idFromName(roomNameFromPath);
                const stub = env.CHAT_ROOM_DO.get(doId);
                const response = await stub.fetch(request);

                // If the DO indicates it needs the HTML, serve it.
                if (response.headers.get("X-DO-Request-HTML") === "true") {
                    return serveHtmlWithEnv(html, env, 'main');
                }
                return response;
            }

            // --- 路由 5: 根路径 (默认页面) ---
            return serveHtmlWithEnv(html, env, 'main');

        } catch (e) {
            console.error("Critical error in main Worker fetch:", e.stack || e);
            return new Response("An unexpected error occurred.", { status: 500 });
        }
    },

    // =================================================================
    // ==                 定时任务 (scheduled handler)                ==
    // =================================================================
    async scheduled(event, env, ctx) {
        console.log(`[Worker] 🚀 Cron Trigger firing! Rule: ${event.cron}`);
        const taskFunction = taskMap.get(event.cron);
        if (taskFunction) {
            ctx.waitUntil(taskFunction(env, ctx));
        } else {
            console.warn(`[Worker] No task defined for cron rule: ${event.cron}`);
        }
    },
};


// =================================================================
// ==               【新】内部任务派发器 (办公室经理)             ==
// =================================================================


/**
 * Dispatches tasks delegated from Durable Objects to the appropriate service/handler.
 * @param {object} task - The task object from the DO.
 * @param {object} env - The environment variables.
 */
async function dispatchInternalTask(task, env) {
    const { command, payload, callbackInfo } = task;
    console.log(`[Worker] Dispatching task: ${command}`, { payload, callbackInfo });

    try {
        let stub;
        switch (command) {
            case 'toutiao_article':
                if (!env.TOUTIAO_SERVICE_DO) throw new Error("Toutiao Service DO is not configured.");
                stub = env.TOUTIAO_SERVICE_DO.get(env.TOUTIAO_SERVICE_DO.idFromName('default'));
                // 将完整的任务单派发给专家DO
                await stub.processAndCallback(task);
                break;

            case 'inspiration':
                if (!env.INSPIRATION_DO) throw new Error("Inspiration Service DO is not configured.");
                // 经理只需将完整的任务单派发给专家，然后就去忙别的了
                stub = env.INSPIRATION_DO.get(env.INSPIRATION_DO.idFromName('global'));
                await stub.processAndCallback(task);
                break;

   // 【新增】处理知乎任务的分支
            case 'zhihu_hot':
            case 'zhihu_article':
                if (!env.ZHIHU_SERVICE_DO) throw new Error("Zhihu Service DO is not configured.");
                stub = env.ZHIHU_SERVICE_DO.get(env.ZHIHU_SERVICE_DO.idFromName('global'));
                await stub.processAndCallback(task);
                break;
            
            case 'kimi_chat':
            case 'news_article':
                throw new Error(`Command "${command}" is not yet implemented with a dedicated DO.`);
                break;

            default:
                throw new Error(`Unknown command: ${command}`);
        }
    } catch (e) {
        console.error(`[Worker] Task dispatch failed for command "${command}":`, e);
        // 如果派发失败，通知用户
        await handleErrorCallback(e, callbackInfo, env);
    }
}
/**
 * Sends an error message back to the chatroom via RPC if a task fails.
 * @param {Error} error - The error that occurred.
 * @param {object} callbackInfo - Information needed to call back to the correct chatroom.
 * @param {object} env - The environment variables.
 */
async function handleErrorCallback(error, callbackInfo, env) {
    if (!callbackInfo || !callbackInfo.roomName || !callbackInfo.messageId) {
        console.error("[Worker] FATAL: Cannot perform error callback due to missing callbackInfo.", { error, callbackInfo });
        return;
    }
    try {
        const chatroomId = env.CHAT_ROOM_DO.idFromName(callbackInfo.roomName);
        const chatroomStub = env.CHAT_ROOM_DO.get(chatroomId);
        const errorText = `> (❌ 任务处理失败: ${error.message})`;
        // Use the 'updateMessage' RPC method on the chatroom DO
        await chatroomStub.updateMessage(callbackInfo.messageId, errorText);
    } catch (callbackError) {
        console.error(`[Worker] FATAL: Error callback to room ${callbackInfo.roomName} failed!`, callbackError);
    }
}


// =================================================================
// ==                 全局 API 处理器 (Worker职责)                ==
// =================================================================

function handleOptions(request) {
    if (
        request.headers.get('Origin') !== null &&
        request.headers.get('Access-Control-Request-Method') !== null &&
        request.headers.get('Access-Control-Request-Headers') !== null
    ) {
        return new Response(null, { headers: corsHeaders });
    }
    return new Response(null, { headers: { Allow: 'GET, HEAD, POST, OPTIONS' } });
}

async function handleUpload(request, env) {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }
    try {
        if (!env.R2_BUCKET) throw new Error('Server config error: R2_BUCKET not bound.');
        const filename = decodeURIComponent(request.headers.get('X-Filename') || 'untitled');
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        const r2ObjectKey = `chating/${Date.now()}-${crypto.randomUUID().substring(0, 8)}-${filename}`;
        const object = await env.R2_BUCKET.put(r2ObjectKey, request.body, { httpMetadata: { contentType } });
        const publicUrl = `${env.R2_PUBLIC_DOMAIN || 'https://pic.want.biz'}/${object.key}`;
        return new Response(JSON.stringify({ url: publicUrl }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    } catch (error) {
        console.error('[Worker] R2 Upload error:', error);
        return new Response(`Error uploading file: ${error.message}`, { status: 500, headers: corsHeaders });
    }
}

async function handleAiExplain(request, env) {
    const { text, model = 'gemini' } = await request.json();
    if (!text) return new Response('Missing "text"', { status: 400, headers: corsHeaders });
    const fullPrompt = `你是一位非常耐心的小学老师...[your prompt]...\n\n${text}`;
    let explanation;
    switch (model) {
        case 'kimi': explanation = await getKimiExplanation(fullPrompt, env); break;
        case 'deepseek': explanation = await getDeepSeekExplanation(fullPrompt, env); break;
        default: explanation = await getGeminiExplanation(fullPrompt, env); break;
    }
    return new Response(JSON.stringify({ explanation }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}

async function handleAiDescribeImage(request, env) {
    const { imageUrl, model = 'gemini' } = await request.json();
    if (!imageUrl) return new Response('Missing "imageUrl"', { status: 400, headers: corsHeaders });
    let description;
    switch (model) {
        case 'kimi': description = await getKimiImageDescription(imageUrl, env); break;
        default: description = await getGeminiImageDescription(imageUrl, env); break;
    }
    return new Response(JSON.stringify({ description }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}


// =================================================================
// ==                     辅助函数 (HTML注入等)                   ==
// =================================================================

function serveHtmlWithEnv(htmlContent, env, pageType = 'main') {
    let injectedScript = `window.ENV_CONFIG = ${JSON.stringify({
        apiDomain: env.API_DOMAIN || 'chat.want.biz',
        flaskApi: env.FLASK_API || 'https://api.yuangs.cc',
        managementRoomsList: (env.MANAGEMENT_ROOMS_LIST || 'general,test').split(',').map(r => r.trim()),
    })};\n`;
    const modifiedHtml = htmlContent.replace('//--CONFIG-PLACEHOLDER--//', injectedScript);
    return new Response(modifiedHtml, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}
