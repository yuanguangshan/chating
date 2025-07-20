// src/worker.js (Merged, Final Version - CORRECTED)

/*
 * 这个 `worker.js` 文件是 Cloudflare Worker 的入口点，它扮演着"前台总机"的角色。
 * 它的主要职责是：
 * 1. 处理全局性的、与特定聊天室无关的API请求（如AI服务、文件上传）。
 * 2. 识别出与特定聊天室相关的请求（无论是API还是WebSocket），并将它们准确地转发给对应的Durable Object实例。
 * 3. 响应定时触发器（Cron Triggers），并调度Durable Object执行定时任务。
 * 4. 为用户提供初始的HTML页面。
 */
// src/worker.js

// --- ✨ 核心修正：添加 polyfill 来定义 global ---
// Cloudflare Workers环境没有`global`，但有些npm包（如echarts）会依赖它。
// 我们在这里创建一个全局的 `global` 变量，并让它指向Worker环境的全局对象 `self`。
globalThis.global = globalThis;


import { HibernatingChating } from './chatroom_do.js';
import { ToutiaoServiceDO } from './toutiaoDO.js';
import html from '../public/index.html';
import managementHtml from '../public/management.html';
import { generateAndPostCharts } from './chart_generator.js';
import { taskMap } from './autoTasks.js';
import { 
    getDeepSeekExplanation, 
    getGeminiExplanation, 
    getGeminiImageDescription,
    getKimiExplanation,
    getKimiImageDescription,
    getKimiChatAnswer
} from './ai.js';
import { getPrice } from './futuresDataService.js';
import ZhihuHotService from './zhihuHotService.js';

// 导出Durable Object类，以便Cloudflare平台能够识别和实例化它。
export { HibernatingChating, ToutiaoServiceDO };

/**
 * 统一的环境变量注入函数
 * @param {string} htmlContent - HTML内容
 * @param {object} env - 环境变量对象
 * @param {string} pageType - 页面类型，用于区分不同的变量注入
 * @returns {string} - 带有注入变量的HTML内容
 */
function injectEnvVariables(htmlContent, env, pageType = 'main') {
    let injectedScript = '';
    
    if (pageType === 'main') {
        injectedScript += `window.FLASK_API_URL = "${env.YOUR_FLASK_PROXY_API_URL || 'http://localhost:5000'}";\n`;
    } else if (pageType === 'management') {
        const roomsListString = env.MANAGEMENT_ROOMS_LIST || 'general,test,future,admin,kerry';
        const roomsArray = roomsListString.split(',').map(room => room.trim());
        
        injectedScript += `window.MANAGEMENT_ROOMS_LIST = ${JSON.stringify(roomsArray)};\n`;
        injectedScript += `window.API_DOMAIN = "${env.API_DOMAIN || 'chat.want.biz'}";\n`;
        injectedScript += `window.ENV_CONFIG = ${JSON.stringify({
            managementRoomsList: roomsArray,
            apiDomain: env.API_DOMAIN || 'chat.want.biz',
            flaskApiUrl: env.YOUR_FLASK_PROXY_API_URL || 'http://localhost:5000'
})};\n`;
    }
    
    // 替换HTML中的占位符
    return htmlContent.replace(
        '//--CONFIG-PLACEHOLDER--//',
        injectedScript
    );
}

/**
 * 注入环境变量到主页面HTML中的辅助函数
 * @param {object} env - 环境变量对象
 * @returns {Response} - 带有注入变量的HTML响应
 */
function serveMainHtmlWithEnv(env) {
    const modifiedHtml = injectEnvVariables(html, env, 'main');
    
    return new Response(modifiedHtml, { 
        headers: { 'Content-Type': 'text/html;charset=UTF-8' } 
    });
}

/**
 * 注入环境变量到管理页面HTML中的辅助函数
 * @param {object} env - 环境变量对象
 * @returns {Response} - 带有注入变量的HTML响应
 */
function serveManagementHtmlWithEnv(env) {
    const modifiedHtml = injectEnvVariables(managementHtml, env, 'management');
    
    return new Response(modifiedHtml, { 
        headers: { 'Content-Type': 'text/html;charset=UTF-8' } 
    });
}

// --- CORS (Cross-Origin Resource Sharing) Headers ---
// 这是一个可重用的对象，用于为API响应添加正确的CORS头部，允许跨域访问。
const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // 生产环境建议替换为您的前端域名
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Filename',
    'Access-Control-Max-Age': '86400', // 预检请求的缓存时间
};

/**
 * 处理浏览器发送的CORS预检请求（OPTIONS方法）。
 */
function handleOptions(request) {
    if (
        request.headers.get('Origin') !== null &&
        request.headers.get('Access-Control-Request-Method') !== null &&
        request.headers.get('Access-Control-Request-Headers') !== null
    ) {
        console.log(`[Worker] Handling CORS preflight request from Origin: ${request.headers.get('Origin')}`);
        return new Response(null, { headers: corsHeaders });
    } else {
        console.log(`[Worker] Handling non-CORS OPTIONS request.`);
        return new Response(null, { headers: { Allow: 'GET, HEAD, POST, OPTIONS' } });
    }
}

// --- AI Service Functions are now in src/ai.js ---
// 文件: src/worker.js

/**
 * 独立的、顶级的辅助函数，用于向指定的房间发送自动帖子。
 * @param {object} env 环境变量
 * @param {string} roomName 要发帖的房间名
 * @param {string} text 帖子的内容
 * @param {object} ctx 执行上下文，用于 waitUntil
 */
async function sendAutoPost(env, roomName, text, ctx) {
    console.log(`Dispatching auto-post to room: ${roomName} via RPC`);
    try {
        if (!env.CHAT_ROOM_DO) {
            throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.");
        }
        
        const doId = env.CHAT_ROOM_DO.idFromName(roomName);
        const stub = env.CHAT_ROOM_DO.get(doId);

        // 【重大修改】从 fetch 调用改为 RPC 调用
        // 使用传入的 ctx.waitUntil 来确保 RPC 调用执行完毕
        ctx.waitUntil(stub.cronPost(text, env.CRON_SECRET));

        console.log(`Successfully dispatched auto-post RPC to room: ${roomName}`);
    } catch (error) {
        console.error(`Error in sendAutoPost for room ${roomName}:`, error.stack || error);
    }
}



// --- 主Worker入口点 ---
// 在 worker.js 的 fetch 函数中

export default {
    async fetch(request, env, ctx) {
        try {
            if (request.method === 'OPTIONS') {
                return handleOptions(request);
            }

            const url = new URL(request.url);
            const pathname = url.pathname;

            // --- 路由 1: 全局独立API (不需转发) ---

                
            // --- ✨ 管理页面路由 ---
            if (pathname === '/management') {
                console.log(`[Worker] Handling /management request.`);
                return serveManagementHtmlWithEnv(env);
            }

            // --- ✨ 新增：用户管理API路由转发 ---
            if (pathname.startsWith('/api/users/')) {
                console.log(`[Worker] Handling /api/users/ request.`);
                const roomName = url.searchParams.get('roomName');
                if (!roomName) {
                    console.warn(`[Worker] /api/users/ request missing roomName parameter.`);
                    return new Response('API request requires a roomName parameter', { status: 400 });
                }
                const doId = env.CHAT_ROOM_DO.idFromName(roomName);
                const stub = env.CHAT_ROOM_DO.get(doId);
                // 将原始请求转发给DO，让DO内部处理
                return await stub.fetch(request);
            }
        
            
            // 将所有全局API的判断合并到一个if/else if结构中
            if (pathname === '/upload') {
                // --- ✨ 这是唯一且正确的 /upload 处理逻辑 ✨ ---
                // (基于您提供的"改进版"代码，并修正了key的使用)
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
                }
                try {
                    if (!env.R2_BUCKET) {
                        throw new Error('Server config error: R2_BUCKET not bound.');
                    }
                    
                    const filenameHeader = request.headers.get('X-Filename');
                    if (!filenameHeader) {
                        throw new Error('Missing X-Filename header');
                    }
                    
                    const filename = decodeURIComponent(filenameHeader);
                    const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
                    
                    // 正确生成包含目录的、唯一的R2对象Key
                    const r2ObjectKey = `chating/${Date.now()}-${crypto.randomUUID().substring(0, 8)}-${filename}`;
                    
                    // 使用正确的key上传到R2
                    const object = await env.R2_BUCKET.put(r2ObjectKey, request.body, {
                         httpMetadata: { contentType: contentType },
                    });
                    
                    // 生成与存储路径完全匹配的公开URL
                    // const r2PublicDomain = "pub-8dfbdda6df204465aae771b4c080140b.r2.dev";
                    const r2PublicDomain = "https://pic.want.biz";
                    const publicUrl = `${r2PublicDomain}/${object.key}`; // object.key 现在是 "chating/..."
                    
                    console.log(`[Worker] File uploaded successfully to R2: ${publicUrl}`);
                    return new Response(JSON.stringify({ url: publicUrl }), {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });

                } catch (error) {
                    console.error('[Worker] R2 Upload error:', error.stack || error);
                    return new Response(`Error uploading file: ${error.message}`, { 
                        status: 500, 
                        headers: corsHeaders 
                    });
                }

            } else if (pathname === '/ai-explain') {
                const { text, model = 'gemini', roomName } = await request.json();
                if (!text) return new Response('Missing "text"', { status: 400, headers: corsHeaders });

                if (roomName) {
                    const doId = env.CHAT_ROOM_DO.idFromName(roomName);
                    const stub = env.CHAT_ROOM_DO.get(doId);
                    ctx.waitUntil(stub.logAndBroadcast(`[AI] 用户请求文本解释，使用模型: ${model}`, 'INFO'));
                }

                const fullPrompt = `你是一位非常耐心的小学老师，专门给小学生讲解新知识。  我是一名小学三年级学生，我特别渴望弄明白事物的含义。  请你用精准、详细的语言解释（Markdown 格式）：1. 用通俗易懂的语言解释下面这段文字。2. 给出关键概念的定义。3. 用生活中的比喻或小故事帮助理解。4. 举一个具体例子，并示范"举一反三"的思考方法。5. 最后用一至两个问题来引导我延伸思考。:\n\n${text}`;
                
                let explanation;
                switch (model) {
                    case 'kimi':
                        explanation = await getKimiExplanation(fullPrompt, env);
                        break;
                    case 'deepseek':
                        explanation = await getDeepSeekExplanation(fullPrompt, env);
                        break;
                    case 'gemini':
                    default:
                        explanation = await getGeminiExplanation(fullPrompt, env);
                        break;
                }

                return new Response(JSON.stringify({ explanation }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

            } else if (pathname === '/ai-describe-image') {
                const { imageUrl, model = 'gemini', roomName } = await request.json();
                if (!imageUrl) return new Response('Missing "imageUrl"', { status: 400, headers: corsHeaders });

                if (roomName) {
                    const doId = env.CHAT_ROOM_DO.idFromName(roomName);
                    const stub = env.CHAT_ROOM_DO.get(doId);
                    ctx.waitUntil(stub.logAndBroadcast(`[AI] 用户请求图片描述，使用模型: ${model}`, 'INFO'));
                }
                
                let description;
                switch (model) {
                    case 'kimi':
                        description = await getKimiImageDescription(imageUrl, env);
                        break;
                    case 'gemini':
                    default:
                        description = await getGeminiImageDescription(imageUrl, env);
                        break;
                }
                
                return new Response(JSON.stringify({ description }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            } else if (pathname === '/api/zhihu/hot') {
                console.log(`[Worker] Handling /api/zhihu/hot request.`);
                try {
                    const limit = parseInt(url.searchParams.get('limit')) || 10;
                    const zhihuHotService = new ZhihuHotService();
                    const data = await zhihuHotService.getCombinedTopics(limit, limit);
                    return new Response(JSON.stringify(data), {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                } catch (error) {
                    console.error('[Worker] Error fetching Zhihu hot topics:', error);
                    return new Response(JSON.stringify({ error: error.message }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                }
            } else if (pathname === '/api/zhihu/search') {
                console.log(`[Worker] Handling /api/zhihu/search request.`);
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
                }
                
                try {
                    const { keyword } = await request.json();
                    if (!keyword) {
                        return new Response(JSON.stringify({ error: 'Missing keyword parameter' }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                    
                    const zhihuHotService = new ZhihuHotService();
                    const topics = await zhihuHotService.generateRelatedTopics(keyword);
                    
                    return new Response(JSON.stringify({ topics }), {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                } catch (error) {
                    console.error('[Worker] Error searching Zhihu topics:', error);
                    return new Response(JSON.stringify({ error: error.message }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                }
            } else if (pathname === '/api/zhihu/article') {
                console.log(`[Worker] Handling /api/zhihu/article request.`);
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
                }
                
                try {
                    const { topicInfo, roomName = 'test' } = await request.json();
                    if (!topicInfo) {
                        return new Response(JSON.stringify({ error: 'Missing topicInfo parameter' }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                    
                    // Forward the request to the DO for processing
                    if (!env.CHAT_ROOM_DO) throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.");
                    const doId = env.CHAT_ROOM_DO.idFromName(roomName);
                    const stub = env.CHAT_ROOM_DO.get(doId);
                    
                    // Call the appropriate method on the DO
                    ctx.waitUntil(stub.generateZhihuArticle({username: 'api_user'}, topicInfo));
                    
                    return new Response(JSON.stringify({ 
                        success: true, 
                        message: "Article generation started. Check the room for results."
                    }), {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                } catch (error) {
                    console.error('[Worker] Error generating Zhihu article:', error);
                    return new Response(JSON.stringify({ error: error.message }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                }
            }

            // --- 路由 2: /api/ 路由处理 ---
            if (pathname.startsWith('/api/')) {
                // 全局API，不转发给DO
                if (pathname === '/api/price') {
                    console.log(`[Worker] Handling /api/price request for symbol: ${url.searchParams.get('symbol')}`);
                    const symbol = url.searchParams.get('symbol');
                    if (!symbol) {
                        console.warn(`[Worker] /api/price request missing symbol parameter.`);
                        return new Response(JSON.stringify({ error: 'Missing symbol parameter' }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                    const priceDataString = await getPrice(symbol);
                    const priceData = JSON.parse(priceDataString);
                    console.log(`[Worker] Successfully fetched price for ${symbol}.`);
                    return new Response(JSON.stringify(priceData), {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                }

                // 需要转发给DO的API
                let roomName = null;
                // 对于这些API，房间名在查询参数里
                if (pathname.startsWith('/api/messages') || pathname.startsWith('/api/reset-room')|| pathname.startsWith('/api/debug')|| pathname.startsWith('/api/room')) {
                    roomName = url.searchParams.get('roomName');
                }
                // 新增：处理 /api/ai/kimi 路由
                if (pathname === '/api/ai/kimi') {
                    const roomName = url.searchParams.get('roomName');
                    if (!roomName) {
                        return new Response(JSON.stringify({ error: 'Missing roomName parameter' }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                    if (request.method !== 'POST') {
                        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
                    }
                    try {
                        const { query } = await request.json();
                        if (!query) {
                            return new Response(JSON.stringify({ error: 'Missing query in request body' }), {
                                status: 400,
                                headers: { 'Content-Type': 'application/json', ...corsHeaders },
                            });
                        }
                        // 注意：getKimiChatAnswer 可能需要一个 history 参数，这里我们传递一个空数组
                        const result = await getKimiChatAnswer(query, [], env);
                        return new Response(JSON.stringify({ result }), {
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    } catch (error) {
                        console.error('Kimi API error in worker:', error);
                        return new Response(JSON.stringify({ error: error.message }), {
                            status: 500,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                }

                // 新增：头条自动发文外部API路由
                if (pathname === '/api/toutiao/direct') {
                    if (request.method !== 'POST') {
                        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
                    }
                    
                    try {
                        const { text, username = 'external_user', roomName = 'external' } = await request.json();
                        if (!text) {
                            return new Response(JSON.stringify({ error: 'Missing text parameter' }), {
                                status: 400,
                                headers: { 'Content-Type': 'application/json', ...corsHeaders },
                            });
                        }

                        // 创建头条任务
                        // 转发到聊天室DO的/toutiao/submit端点
                if (!env.CHAT_ROOM_DO) throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.");
                const doId = env.CHAT_ROOM_DO.idFromName(roomName);
                const stub = env.CHAT_ROOM_DO.get(doId);
                
                // 调用DO的handleToutiaoSubmit方法
                const apiUrl = new URL(request.url);
                apiUrl.pathname = '/api/toutiao/submit';
                
                const response = await stub.fetch(new Request(apiUrl.toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: text,
                        topic: '外部提交',
                        platform: 'default'
                    })
                }));

                const result = await response.json();
                return new Response(JSON.stringify(result), {
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });

                    } catch (error) {
                        console.error('Toutiao direct API error:', error);
                        return new Response(JSON.stringify({ error: error.message }), {
                            status: 500,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                }

                if (pathname.startsWith('/api/toutiao/status/')) {
                    if (request.method !== 'GET') {
                        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
                    }
                    try {
                        const taskId = pathname.substring('/api/toutiao/status/'.length);
                        if (!taskId) {
                            return new Response(JSON.stringify({ error: 'Missing taskId parameter' }), {
                                status: 400,
                                headers: { 'Content-Type': 'application/json', ...corsHeaders },
                            });
                        }
                        const doId = env.TOUTIAO_SERVICE_DO.idFromName('default');
                        const stub = env.TOUTIAO_SERVICE_DO.get(doId);
                        const result = await stub.fetch(new Request(new URL(`/results?id=${taskId}`, request.url).toString()));
                        return new Response(result.body, {
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    } catch (error) {
                        console.error('Toutiao status API error:', error);
                        return new Response(JSON.stringify({ error: error.message }), {
                            status: 500,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                } else if (pathname === '/api/toutiao/queue') {
                    if (request.method !== 'GET') {
                        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
                    }
                    try {
                        const doId = env.TOUTIAO_SERVICE_DO.idFromName('default');
                        const stub = env.TOUTIAO_SERVICE_DO.get(doId);
                    const result = await stub.fetch(new Request(new URL(`/queue`, request.url).toString()));
                        return new Response(result.body, {
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    } catch (error) {
                        console.error('Toutiao queue API error:', error);
                        return new Response(JSON.stringify({ error: error.message }), {
                            status: 500,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                } else if (pathname === '/api/toutiao/clearQueue') {
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
                }
                try {
                    const doId = env.TOUTIAO_SERVICE_DO.idFromName('default');
                    const stub = env.TOUTIAO_SERVICE_DO.get(doId);
                    const result = await stub.fetch(new Request(new URL(`/clearQueue`, request.url).toString(), {
                        method: 'POST'
                    }));
                    return new Response(result.body, {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                } catch (error) {
                    console.error('Toutiao clearQueue API error:', error);
                    return new Response(JSON.stringify({ error: error.message }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                }
                } else if (pathname === '/api/toutiao/stats') {
                    if (request.method !== 'GET') {
                        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
                    }
                    try {
                        const doId = env.TOUTIAO_SERVICE_DO.idFromName('default');
                        const stub = env.TOUTIAO_SERVICE_DO.get(doId);
                        const result = await stub.fetch(new Request(new URL(`/stats`, request.url).toString()));
                        return new Response(result.body, {
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    } catch (error) {
                        console.error('Toutiao stats API error:', error);
                        return new Response(JSON.stringify({ error: error.message }), {
                            status: 500,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                } else if (pathname === '/api/toutiao/results') {
                    if (request.method !== 'GET') {
                        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
                    }
                    try {
                        const doId = env.TOUTIAO_SERVICE_DO.idFromName('default');
                        const stub = env.TOUTIAO_SERVICE_DO.get(doId);
                        const result = await stub.fetch(new Request(new URL(`/results`, request.url).toString()));
                        return new Response(result.body, {
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    } catch (error) {
                        console.error('Toutiao results API error:', error);
                        return new Response(JSON.stringify({ error: error.message }), {
                            status: 500,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                } else if (pathname === '/api/toutiao/queue' && request.method === 'DELETE') {
                    try {
                        const doId = env.TOUTIAO_SERVICE_DO.idFromName('default');
                        const stub = env.TOUTIAO_SERVICE_DO.get(doId);
                        const result = await stub.fetch(new Request(new URL(`/queue`, request.url).toString(), {
                            method: 'DELETE'
                        }));
                        return new Response(result.body, {
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    } catch (error) {
                        console.error('Toutiao process queue API error:', error);
                        return new Response(JSON.stringify({ error: error.message }), {
                            status: 500,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
            }



                // (未来可以为其他API在这里添加 roomName 的获取逻辑)

                if (!roomName) {
                    return new Response('API request requires a roomName parameter', { status: 400 });
                }

                if (!env.CHAT_ROOM_DO) throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.");
                const doId = env.CHAT_ROOM_DO.idFromName(roomName);
                const stub = env.CHAT_ROOM_DO.get(doId);
                return stub.fetch(request); // 直接转发并返回DO的响应
            }

            // --- 路由 3: 房间页面加载 和 WebSocket 连接 ---
            // 匹配所有不以 /api/ 开头的路径，例如 /test, /general
            const pathParts = pathname.slice(1).split('/');
            const roomNameFromPath = pathParts[0];

            // 过滤掉空的路径部分和 favicon.ico 请求
            if (roomNameFromPath && roomNameFromPath !== 'favicon.ico') {
                 if (!env.CHAT_ROOM_DO) throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.");
                 const doId = env.CHAT_ROOM_DO.idFromName(roomNameFromPath);
                 const stub = env.CHAT_ROOM_DO.get(doId);
                 const response = await stub.fetch(request);

                 // 只有在DO明确要求时，才返回HTML
                 if (response.headers.get("X-DO-Request-HTML") === "true") {
                     return serveMainHtmlWithEnv(env);
                 }
                 return response;
            }

            // --- 路由 4: 根路径 或 其他未匹配路径，注入环境变量后返回HTML ---
            return serveMainHtmlWithEnv(env);

        } catch (e) {
            console.error("Critical error in main Worker fetch:", e.stack || e);
            return new Response("An unexpected error occurred.", { status: 500 });
        }
    },

    /**
     * 【重构后】处理由Cron Trigger触发的定时事件。
     */
async scheduled(event, env, ctx) {
        console.log(`[Worker] 🚀🚀🚀🚀 Cron Trigger firing! Rule: ${event.cron}🚀🚀🚀`);

        const taskFunction = taskMap.get(event.cron);

        if (taskFunction) {
            console.log(`[Worker] 🧮 Executing task for cron rule: ${event.cron}`);
            
            // 【关键修改】: 执行任务并获取返回的状态结果
            const result = await taskFunction(env, ctx);
            
            // 如果任务函数返回了结果，就进行广播通知
            if (result && result.roomName) {
                try {
                    const doId = env.CHAT_ROOM_DO.idFromName(result.roomName);
                    const stub = env.CHAT_ROOM_DO.get(doId);
                    
                    // 准备要广播的系统消息内容
                    const systemMessagePayload = result.success 
                        ? { message: `✅ 定时任务'${event.cron}'执行成功: ${result.message}`, level: 'SUCCESS' }
                        : { message: `❌ 定时任务'${event.cron}'执行失败: ${result.error}`, level: 'ERROR', data: result };

                    // 调用新的RPC方法来广播通知
                    // 同样使用 waitUntil 确保它在后台完成
                    ctx.waitUntil(stub.broadcastSystemMessage(systemMessagePayload, env.CRON_SECRET));

                } catch(e) {
                    console.error(`[Worker] Failed to broadcast cron status for room ${result.roomName}:`, e);
                }
            }

        } else {
            console.warn(`[Worker] No task defined for cron rule: ${event.cron}`);
        }
    },
};


const API_BASE_URL = 'https://api.yuangs.cc';

async function fetchFuturesData() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/futures/hqdata`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const { data, columns } = await response.json();
    // 处理数据...
    console.log('成功获取期货数据:', data);
    return data;
  } catch (error) {
    console.error('获取期货数据失败:', error);
    throw error;
  }
}

// 其他数据库的类似方法...