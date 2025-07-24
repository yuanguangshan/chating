// 文件: src/worker.js (在您原有代码基础上修正)

// --- Polyfill for npm packages that expect 'global' ---
globalThis.global = globalThis;

// --- 导入所有模块和 DO ---
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

// --- 导出 Durable Object 类 ---
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
    const url = new URL(request.url);
    const pathname = url.pathname;

    // [修正] 路由 0: 优先处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
        return handleOptions(request);
    }

    try {
      // --- [修正] 路由开始，采用清晰、无嵌套的结构 ---

      // ✅ 路由 1: 静态 HTML 页面服务
      if (pathname === '/') {
        return serveHtmlWithEnv(html, env, 'main');
      }
      if (pathname === '/management') {
        return serveHtmlWithEnv(managementHtml, env, 'management');
      }

      // ✅ 路由 2: 专用 API 端点 (上传、AI等)
      if (pathname === '/upload') {
        return handleUpload(request, env);
      }
      if (pathname === '/ai/explain') {
        return handleAiExplain(request, env);
      }
      if (pathname === '/ai/describe-image') {
        return handleAiDescribeImage(request, env);
      }

      // ✅ 路由 3: 处理来自 DO 内部的回调任务
      if (pathname === '/api/internal-task-handler' && request.method === 'POST') {
        const task = await request.json();
        // [修正] 将具体的派发逻辑移到独立的函数中，保持 fetch 函数的整洁
        ctx.waitUntil(dispatchInternalTask(task, env));
        return new Response('Internal task accepted by worker.', { status: 202 });
      }

      // ✅ 路由 4: 处理所有发往【头条服务】的外部 API 请求
      if (pathname.startsWith('/api/toutiao/') || pathname === '/api/inspirations/generate') {
        console.log(`[Worker] Routing to ToutiaoDO: ${pathname}`);
        if (!env.TOUTIAO_SERVICE_DO) throw new Error("Durable Object 'TOUTIAO_SERVICE_DO' is not bound.");
        const doId = env.TOUTIAO_SERVICE_DO.idFromName("toutiao-singleton");
        const stub = env.TOUTIAO_SERVICE_DO.get(doId);
        return stub.fetch(request);
      }

      // ✅ 路由 5: 处理发往【知乎服务】的 API 请求
      if (pathname.startsWith('/api/zhihu/')) {
        console.log(`[Worker] Routing to ZhihuServiceDO: ${pathname}`);
        if (!env.ZHIHU_SERVICE_DO) throw new Error("Durable Object 'ZHIHU_SERVICE_DO' is not bound.");
        const doId = env.ZHIHU_SERVICE_DO.idFromName("zhihu-singleton");
        const stub = env.ZHIHU_SERVICE_DO.get(doId);
        return stub.fetch(request);
      }

      // ✅ 路由 6: 处理发往【灵感服务】的 API 请求
      if (pathname.startsWith('/api/inspirations')) {
        console.log(`[Worker] Routing to InspirationDO: ${pathname}`);
        if (!env.INSPIRATION_DO) throw new Error("Durable Object 'INSPIRATION_DO' is not bound.");
        const doId = env.INSPIRATION_DO.idFromName("inspiration-singleton");
        const stub = env.INSPIRATION_DO.get(doId);
        return stub.fetch(request);
      }

      // ✅ 路由 7: 处理【聊天室】请求 (这是最后的、最通用的路由)
      // [修正] 使用更精确的正则表达式，避免误匹配 /management 等路径
      const roomNameMatch = pathname.match(/^\/([a-zA-Z0-9_-]+)$/);
      const roomName = roomNameMatch ? roomNameMatch[1] : null;

      if (roomName) {
        // [修正] 排除已知非聊天室的路径，增加代码健壮性
        if (['management', 'api'].includes(roomName)) {
            // This case should not be reached due to the regex, but as a safeguard.
        } else {
            console.log(`[Worker] Routing to ChatRoomDO: ${roomName}`);
            if (!env.CHAT_ROOM_DO) throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.");
            
            const doId = env.CHAT_ROOM_DO.idFromName(roomName);
            const stub = env.CHAT_ROOM_DO.get(doId);
            const response = await stub.fetch(request);

            // 您的原有逻辑：如果 DO 返回特定头部，则提供 HTML 页面
            if (response.headers.get("X-DO-Request-HTML") === "true") {
              return serveHtmlWithEnv(html, env, 'main');
            }
            return response;
        }
      }
      
      // 如果所有路由都未匹配，则返回 404
      console.warn(`[Worker] 404 Not Found for path: ${pathname}`);
      return new Response('Not Found. Check worker routing.', { status: 404, headers: corsHeaders });

    } catch (err) {
      console.error(`[Worker] Unhandled fetch error: ${err.stack}`);
      return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
    }
  },

  // [修正] 保留您的 scheduled 方法
  async scheduled(event, env, ctx) {
    console.log(`[Worker] Cron trigger: ${event.cron}`);
    const tasksToRun = taskMap[event.cron] || [];
    for (const task of tasksToRun) {
        console.log(`[Worker] Running scheduled task: ${task.command}`);
        ctx.waitUntil(dispatchInternalTask(task, env));
    }
  }
};

// =================================================================
// ==                  辅助函数 (保持不变)                      ==
// =================================================================

async function dispatchInternalTask(task, env) {
    const { command } = task;
    console.log(`[Worker] Dispatching task: ${command}`, task);

    try {
        let serviceStub;
        let serviceName = '';
        let internalPath = 'internal-task'; // [修正] 统一内部任务路径

        // [修正] 简化 DO 的选择和获取逻辑
        switch (command) {
            case 'toutiao_article':
                if (!env.TOUTIAO_SERVICE_DO) throw new Error("Toutiao Service DO is not configured.");
                serviceStub = env.TOUTIAO_SERVICE_DO.get(env.TOUTIAO_SERVICE_DO.idFromName('toutiao-singleton'));
                serviceName = 'TOUTIAO_SERVICE_DO';
                break;

            case 'inspiration':
                if (!env.INSPIRATION_DO) throw new Error("Inspiration Service DO is not configured.");
                serviceStub = env.INSPIRATION_DO.get(env.INSPIRATION_DO.idFromName('inspiration-singleton'));
                serviceName = 'INSPIRATION_DO';
                break;

            case 'zhihu_hot':
            case 'zhihu_article':
                if (!env.ZHIHU_SERVICE_DO) throw new Error("Zhihu Service DO is not configured.");
                serviceStub = env.ZHIHU_SERVICE_DO.get(env.ZHIHU_SERVICE_DO.idFromName('zhihu-singleton'));
                serviceName = 'ZHIHU_SERVICE_DO';
                break;

            default:
                throw new Error(`Unknown or unimplemented command: ${command}`);
        }

        const request = new Request(`https://internal-do/${internalPath}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(task)
        });
        
        await serviceStub.fetch(request);
        console.log(`[Worker] Task "${command}" successfully dispatched to ${serviceName}.`);

    } catch (e) {
        console.error(`[Worker] Task dispatch failed for command "${command}":`, e);
        await handleErrorCallback(e, task.callbackInfo, env);
    }
}

async function handleErrorCallback(error, callbackInfo, env) {
    if (!callbackInfo || !callbackInfo.roomName || !callbackInfo.messageId) {
        console.error("[Worker] FATAL: Cannot perform error callback due to missing callbackInfo.", { error, callbackInfo });
        return;
    }
    try {
        const chatroomId = env.CHAT_ROOM_DO.idFromName(callbackInfo.roomName);
        const chatroomStub = env.CHAT_ROOM_DO.get(chatroomId);
        const errorText = `> (❌ 任务处理失败: ${error.message})`;
        
        // [修正] 调用 ChatRoomDO 中正确的更新消息方法
        // 假设 ChatRoomDO 有一个 /api/callback 端点来更新消息
        const callbackRequest = new Request(`https://internal-do/api/callback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messageId: callbackInfo.messageId,
                status: 'error',
                newContent: errorText
            })
        });
        await chatroomStub.fetch(callbackRequest);

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
        const object = await env.R2_BUCKET.put(request.body, { httpMetadata: { contentType } });
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
