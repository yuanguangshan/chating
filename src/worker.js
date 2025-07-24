// 文件: src/worker.js (已修正并优化)

// --- Polyfill for npm packages that expect 'global' ---
globalThis.global = globalThis;

import { HibernatingChating2 } from './chatroom_do.js';
import { ToutiaoServiceDO2 } from './toutiaoDO.js';
import { ZhihuServiceDO } from './zhihuServiceDO.js';
import { AuthServiceDO2 } from './authServiceDO.js';
import { InspirationDO } from './InspirationDO.js';
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
import { MSG_TYPE_GEMINI_CHAT } from './constants.js';

// Export Durable Object classes
export { HibernatingChating2, ToutiaoServiceDO2, AuthServiceDO2, InspirationDO, ZhihuServiceDO };

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
            if (request.method === 'OPTIONS') {
                return handleOptions(request);
            }

            const url = new URL(request.url);
            const pathname = url.pathname;

            // --- 路由 1: 内部任务处理器 ---
            if (pathname === '/api/internal-task-handler') {
                if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
                const task = await request.json();
                ctx.waitUntil(dispatchInternalTask(task, env));
                return new Response('Task accepted', { status: 202 });
            }

            // --- 路由 2: 全局独立API (保持不变) ---
            if (pathname === '/upload') return handleUpload(request, env);
            if (pathname === '/ai-explain') return handleAiExplain(request, env);
            if (pathname === '/ai-describe-image') return handleAiDescribeImage(request, env);

            // --- 路由 3: 静态页面与资源 (保持不变) ---
            if (pathname === '/management') return serveHtmlWithEnv(managementHtml, env, 'management');
            if (pathname === '/favicon.ico') return new Response(null, { status: 302, headers: { 'Location': 'https://pic.want.biz/favicon.svg' } });

            // --- 路由 4: 转发到特定Durable Object (保持不变) ---
            const pathParts = pathname.slice(1).split('/');
            const roomNameFromPath = pathParts[0];

            if (roomNameFromPath) {
                if (pathname === '/api/inspirations' || pathname === '/inspirations') {
                    if (!env.INSPIRATION_DO) throw new Error("Durable Object 'INSPIRATION_DO' is not bound.");
                    const doId = env.INSPIRATION_DO.idFromName("global");
                    const stub = env.INSPIRATION_DO.get(doId);
                    return stub.fetch(request);
                }
                if (pathname.startsWith('/api/toutiao/')) {
                    if (!env.TOUTIAO_SERVICE_DO) throw new Error("Durable Object 'TOUTIAO_SERVICE_DO' is not bound.");
                    const doId = env.TOUTIAO_SERVICE_DO.idFromName("management");
                    const stub = env.TOUTIAO_SERVICE_DO.get(doId);
                    return stub.fetch(request);
                }
                if (pathname.startsWith('/api/zhihu/')) {
                    if (!env.ZHIHU_SERVICE_DO) throw new Error("Durable Object 'ZHIHU_SERVICE_DO' is not bound.");
                    const doId = env.ZHIHU_SERVICE_DO.idFromName("global");
                    const stub = env.ZHIHU_SERVICE_DO.get(doId);
                    return stub.fetch(request);
                }
                if (pathname.startsWith('/api/room/status')) {
                    const roomName = url.searchParams.get('roomName');
                    if (!roomName) return new Response('roomName parameter is required', { status: 400 });
                    if (!env.CHAT_ROOM_DO) throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.");
                    const doId = env.CHAT_ROOM_DO.idFromName(roomName);
                    const stub = env.CHAT_ROOM_DO.get(doId);
                    return stub.fetch(request);
                }
                if (!env.CHAT_ROOM_DO) throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.");
                const doId = env.CHAT_ROOM_DO.idFromName(roomNameFromPath);
                const stub = env.CHAT_ROOM_DO.get(doId);
                const response = await stub.fetch(request);
                if (response.headers.get("X-DO-Request-HTML") === "true") {
                    return serveHtmlWithEnv(html, env, 'main');
                }
                return response;
            }

            // --- 路由 5: 根路径 (保持不变) ---
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

        switch (event.cron) {
            case '* * * * *':
                const roomName = "test";
                const message = "⏰ 滴答！这是一条来自服务器的每分钟定时消息。";
                try {
                    const roomId = env.CHAT_ROOM_DO.idFromName(roomName);
                    const roomStub = env.CHAT_ROOM_DO.get(roomId);
                    ctx.waitUntil(roomStub.cronPost(message, env.CRON_SECRET));
                    console.log(`[Worker] ✅ Cron task for rule "${event.cron}" has been dispatched to room "${roomName}".`);
                } catch (e) {
                    console.error(`[Worker] ❌ Failed to dispatch cron task for rule "${event.cron}"`, e);
                }
                break;

            default:
                const taskFunction = taskMap.get(event.cron);
                if (taskFunction) {
                    ctx.waitUntil(taskFunction(env, ctx));
                } else {
                    console.warn(`[Worker] No task defined for cron rule: ${event.cron}`);
                }
                break;
        }
    },
};

// =================================================================
// ==               【核心修改】内部任务派发器                     ==
// =================================================================

/**
 * Dispatches tasks using a robust fetch-based approach.
 * @param {object} task - The task object from the DO.
 * @param {object} env - The environment variables.
 */
async function dispatchInternalTask(task, env) {
    const { command } = task;
    console.log(`[Worker] Dispatching task: ${command}`, task);

    try {
        let serviceStub;
        let serviceName = '';
        // ✅ [核心修改] 定义一个变量来存储目标路径
        let internalPath = '';

        switch (command) {
            case 'toutiao_article':
                if (!env.TOUTIAO_SERVICE_DO) throw new Error("Toutiao Service DO is not configured.");
                // ❌ 错误原因：之前这里没有指定正确的路径
                // ✅ 修正：为头条任务指定正确的内部路径 'internal-task'
                serviceStub = env.TOUTIAO_SERVICE_DO.get(env.TOUTIAO_SERVICE_DO.idFromName('default'));
                serviceName = 'TOUTIAO_SERVICE_DO';
                internalPath = 'internal-task'; // 指定正确的路径
                break;

            case 'inspiration':
                if (!env.INSPIRATION_DO) throw new Error("Inspiration Service DO is not configured.");
                serviceStub = env.INSPIRATION_DO.get(env.INSPIRATION_DO.idFromName('global'));
                serviceName = 'INSPIRATION_DO';
                // 假设 InspirationDO 也使用 'internal-task' 路径，这是一种好的实践
                internalPath = 'internal-task';
                break;

            case 'zhihu_hot':
            case 'zhihu_article':
                if (!env.ZHIHU_SERVICE_DO) throw new Error("Zhihu Service DO is not configured.");
                serviceStub = env.ZHIHU_SERVICE_DO.get(env.ZHIHU_SERVICE_DO.idFromName('global'));
                serviceName = 'ZHIHU_SERVICE_DO';
                // 假设 ZhihuServiceDO 也使用 'internal-task' 路径
                internalPath = 'internal-task';
                break;

            default:
                throw new Error(`Unknown or unimplemented command: ${command}`);
        }

        // ✅ [核心修改] 使用定义好的 internalPath 变量来构建请求URL
        const request = new Request(`https://internal-do/${internalPath}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(task)
        });
        
        await serviceStub.fetch(request);
        console.log(`[Worker] Task "${command}" successfully dispatched to ${serviceName} via fetch with path "/${internalPath}".`);

    } catch (e) {
        console.error(`[Worker] Task dispatch failed for command "${command}":`, e);
        await handleErrorCallback(e, task.callbackInfo, env);
    }
}

// --- 其他函数 (handleErrorCallback, handleOptions, handleUpload, etc.) 保持不变 ---

async function handleErrorCallback(error, callbackInfo, env) {
    if (!callbackInfo || !callbackInfo.roomName || !callbackInfo.messageId) {
        console.error("[Worker] FATAL: Cannot perform error callback due to missing callbackInfo.", { error, callbackInfo });
        return;
    }
    try {
        const chatroomId = env.CHAT_ROOM_DO.idFromName(callbackInfo.roomName);
        const chatroomStub = env.CHAT_ROOM_DO.get(chatroomId);
        const errorText = `> (❌ 任务处理失败: ${error.message})`;
        await chatroomStub.updateMessageAndBroadcast(callbackInfo.messageId, errorText);
    } catch (callbackError) {
        console.error(`[Worker] FATAL: Error callback to room ${callbackInfo.roomName} failed!`, callbackError);
    }
}

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

function serveHtmlWithEnv(htmlContent, env, pageType = 'main') {
    let injectedScript = `window.ENV_CONFIG = ${JSON.stringify({
        apiDomain: env.API_DOMAIN || 'chat.want.biz',
        flaskApi: env.FLASK_API || 'https://api.yuangs.cc',
        managementRoomsList: (env.MANAGEMENT_ROOMS_LIST || 'general,test').split(',').map(r => r.trim()),
    })};\n`;
    const modifiedHtml = htmlContent.replace('//--CONFIG-PLACEHOLDER--//', injectedScript);
    return new Response(modifiedHtml, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}
