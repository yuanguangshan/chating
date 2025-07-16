// src/ai.js

import { getPrice } from './futuresDataService.js';
import { getNews } from './newsService.js';
import { drawChart } from './chart_generator.js';
import * as fq from './futuresToolkit.js';
import { smartQuery } from './dataApiService.js';

// 绑定AI可用的工具函数
const availableTools = {
    get_price: (args) => getPrice(args.name),
    get_news: (args) => getNews(args.keyword),
    draw_chart: (args, env) => drawChart(env, args.symbol, args.period),
    
    // 新增
    query_fut_daily: (args) => fq.queryFuturesDaily(args.symbol, args.limit),
    query_minutely: (args) => fq.queryMinutelyHistory(args.symbol, args.days),
    query_option: (args) => fq.queryOptionQuote(args.symbol, args.limit),
    query_lhb: (args) => fq.queryLHB(args.symbol, args.limit),
    query_aggregate: (args) => fq.queryAggregate(args.symbol, args.days, args.aggFunc, args.column),
    smart_query: (args) => fq.smartQuery(args.query),
    get_highest_price: (args) => fq.getHighestPrice(args.symbol, args.days),
    get_lowest_price: (args) => fq.getLowestPrice(args.symbol, args.days)
};

// =================================================================
//  Kimi API 调用函数 (新增)
// =================================================================
/**
 * 调用Kimi API的函数，兼容OpenAI接口格式
 * @param {string} model - 要调用的模型名称
 * @param {object} payload - 发送给API的请求体
 * @param {object} env - 环境变量，包含KIMI_API_KEY
 * @param {function} [logCallback] - 用于记录日志的回调函数
 * @returns {Promise<object>} - 返回API的JSON响应
 * @throws {Error} - 如果调用失败，则抛出错误
 */
async function callKimiApi(model, payload, env, logCallback = () => {}) {
    const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY;
    if (!apiKey) {
        throw new Error('服务器配置错误：未设置KIMI_API_KEY。');
    }

    const url = "https://api.moonshot.cn/v1/chat/completions";
    logCallback(`🚀 [API Request] Calling Kimi API: POST ${url}`);

    const response = await fetch(url, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            ...payload
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AI] Kimi API调用失败，状态码 ${response.status}: ${errorText}`);
        throw new Error(`Kimi API错误: ${errorText}`);
    }
    console.log(`[AI] Kimi API调用成功。`);
    return await response.json();
}

// =================================================================
//  核心 Gemini API 调用函数 (重构后)
// =================================================================
/**
 * 统一调用Google Gemini API的函数，内置密钥切换和模型回退逻辑。
 * @param {string} modelUrl - 要调用的模型URL (不含API Key)。
 * @param {object} payload - 发送给API的请求体。
 * @param {object} env - 环境变量，包含GEMINI_API_KEY和可选的GEMINI_API_KEY2。
 * @param {function} [logCallback] - 用于记录日志的回调函数
 * @returns {Promise<object>} - 返回API的JSON响应。
 * @throws {Error} - 如果所有尝试都失败，则抛出错误。
 */
async function callGeminiApi(modelUrl, payload, env, logCallback = () => {}) {
    const keys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY2,env.GEMINI_API_KEY3].filter(Boolean);
    if (keys.length === 0) {
        throw new Error('服务器配置错误：未设置GEMINI_API_KEY。');
    }

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const urlWithKey = `${modelUrl}?key=${key}`;
        
        try {
            logCallback(`🚀 [API Request] Calling Gemini API: POST ${modelUrl} (Key ${i + 1})`);
            const response = await fetch(urlWithKey, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return await response.json();
            }

            const errorText = await response.text();
            // 如果是配额用尽错误，并且还有其他密钥，则继续尝试下一个
            if (response.status === 429 && errorText.includes("RESOURCE_EXHAUSTED") && i < keys.length - 1) {
                console.log(`[AI] API密钥 ${i + 1} 配额已用尽，正在尝试下一个密钥。`);
                continue; 
            }
            
            // 对于其他错误或这是最后一个密钥，则直接抛出错误
            throw new Error(`Gemini API错误 (密钥 ${i + 1}): ${errorText}`);

        } catch (error) {
            // 如果是网络错误等，并且还有其他密钥，也尝试下一个
            if (i < keys.length - 1) {
                console.error(`[AI] API密钥 ${i + 1} 出错:`, error.message, "正在尝试下一个密钥。");
                continue;
            }
            // 这是最后一个密钥了，重新抛出错误
            console.error(`[AI] 所有Gemini API密钥均失败或最后一个密钥失败:`, error.message);
            throw error;
        }
    }
    // 如果所有密钥都因配额问题失败，则抛出最终错误
    console.error("[AI] 所有可用的Gemini API密钥配额均已用尽。");
    throw new Error("所有可用的Gemini API密钥配额均已用尽。");
}

// =================================================================
//  导出的公共函数 (保持接口不变)
// =================================================================

/**
 * 调用 DeepSeek API 获取文本解释。
 */
export async function getDeepSeekExplanation(text, env) {
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('服务器配置错误：未设置DEEPSEEK_API_KEY。');

    const now = new Date();
    const beijingTimeFormatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: 'numeric', hour12: false, timeZone: 'Asia/Shanghai'
    });
    const [beijingHourStr, beijingMinuteStr] = beijingTimeFormatter.format(now).split(':');
    const beijingHour = parseInt(beijingHourStr, 10);
    const beijingMinute = parseInt(beijingMinuteStr, 10);

    let modelToUse = "deepseek-chat";
    if ((beijingHour === 0 && beijingMinute >= 31) || (beijingHour > 0 && beijingHour < 8) || (beijingHour === 8 && beijingMinute <= 29)) {
        modelToUse = "deepseek-reasoner";
    }

    const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: modelToUse,
            messages: [{ role: "system", content: "你是一个有用的，善于用简洁的markdown语言来解释下面的文本." }, { role: "user", content: text }],
            temperature: 0.8,
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AI] DeepSeek API错误: ${errorText}`);
        throw new Error(`DeepSeek API错误: ${errorText}`);
    }
    const data = await response.json();
    const explanation = data?.choices?.[0]?.message?.content;
    if (!explanation) {
        console.error('[AI] DeepSeek返回了意外的AI响应格式:', data);
        throw new Error('DeepSeek返回了意外的AI响应格式。');
    }
    console.log(`[AI] DeepSeek解释已生成。`);
    return explanation;
}

/**
 * 【修正版】从URL获取图片并高效地转换为Base64编码。
 */
async function fetchImageAsBase64(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
            console.error(`[AI] 从 ${imageUrl} 获取图片失败: ${response.status} ${response.statusText}`);
            throw new Error(`获取图片失败: ${response.status} ${response.statusText}`);
        }
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const buffer = await response.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        console.log(`[AI] 图片已获取并转换为Base64: ${imageUrl}`);
        return { base64, contentType };
    } catch (e) {
        console.error(`[AI] 获取或转换图片 ${imageUrl} 为Base64时出错: ${e.message}`, e);
        throw e;
    }
}

/**
 * 调用 Google Gemini API 获取图片描述。
 */
export async function getGeminiImageDescription(imageUrl, env) {
    const { base64, contentType } = await fetchImageAsBase64(imageUrl);
    const proModelUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`;
    const prompt = "请仔细描述图片的内容，如果图片中识别出有文字，则在回复的内容中返回这些文字，并且这些文字支持复制，之后是对文字的仔细描述，格式为：图片中包含文字：{文字内容}；图片的描述：{图片描述}";
    
    const payload = {
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: contentType, data: base64 } }] }]
    };

    try {
        const data = await callGeminiApi(proModelUrl, payload, env);
        const description = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!description) {
            console.error('[AI] Gemini Vision返回了意外的AI响应格式:', data);
            throw new Error('Gemini Vision返回了意外的AI响应格式。');
        }
        console.log(`[AI] Gemini图片描述已生成。`);
        return description;
    } catch (error) {
        console.error("[AI] getGeminiImageDescription失败:", error);
        return "抱歉，图片描述服务暂时无法使用。";
    }
}

/**
 * 调用 Google Gemini API 获取文本解释。
 */
export async function getGeminiExplanation(text, env) {
    const proModelUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`;
    const payload = { contents: [{ parts: [{ text: text }] }] };

    try {
        const data = await callGeminiApi(proModelUrl, payload, env);
        const explanation = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!explanation) {
            console.error('[AI] Gemini Explanation返回了意外的AI响应格式:', data);
            throw new Error('Gemini返回了意外的AI响应格式。');
        }
        console.log(`[AI] Gemini解释已生成。`);
        return explanation;
    } catch (error) {
        console.error("[AI] getGeminiExplanation失败:", error);
        return "抱歉，文本解释服务暂时无法使用。";
    }
}


/**
 * 调用 Google Gemini API 获取聊天回复（支持多轮函数调用）。
 * @param {string} question - 用户的问题
 * @param {Array} history - 聊天历史
 * @param {object} env - 环境变量
 * @param {function} [logCallback] - 用于记录日志的回调函数
 */
export async function getGeminiChatAnswer(question, history = [], env, logCallback = () => {}) {
    const flashModelUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
    const proModelUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`;

    const tools = [{
        functionDeclarations: [
            { name: "get_price", description: "获取指定期货品种的详细信息", parameters: { type: "OBJECT", properties: { name: { type: "STRING", description: "期货品种的中文名称, 例如 '螺纹钢', '黄金'" } }, required: ["name"] } },
            { name: "get_news", description: "获取某个关键词的最新新闻", parameters: { type: "OBJECT", properties: { keyword: { type: "STRING", description: "要查询新闻的关键词, 例如 '原油'" } }, required: ["keyword"] } },
            { name: "draw_chart", description: "根据代码和周期绘制K线图", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING", description: "期货合约代码, 例如 'ag'" }, period: { type: "STRING", description: "图表周期, 例如 'daily'" } }, required: ["symbol", "period"] } },
            // 新增
            { name: "query_fut_daily", description: "获取期货品种日线行情", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING", description: "如 rb、cu" }, limit: { type: "INTEGER", description: "条数，默认100" } }, required: ["symbol"] } },
            { name: "query_minutely", description: "获取期货品种最近 N 天的 1 分钟 K 线", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING" }, days: { type: "INTEGER", description: "最近 N 天", default: 1 } }, required: ["symbol", "days"] } },
            { name: "query_option", description: "获取期权日线行情", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING" }, limit: { type: "INTEGER", default: 100 } }, required: ["symbol"] } },
            { name: "query_lhb", description: "获取期货龙虎榜数据", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING" }, limit: { type: "INTEGER", default: 100 } }, required: ["symbol"] } },
            { name: "query_aggregate", description: "聚合查询期货数据（如最高价、最低价、平均成交量等）", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING", description: "品种代码如rb、cu等" }, days: { type: "INTEGER", description: "查询天数，默认5天" }, aggFunc: { type: "STRING", description: "聚合函数：MAX、MIN、AVG、SUM" }, column: { type: "STRING", description: "字段名：最高、最低、成交量等" } }, required: ["symbol"] } },
            { name: "smart_query", description: "智能期货查询，支持自然语言如'螺纹钢过去5天最高价'", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "自然语言查询，例如'螺纹钢过去5天最高价'或'帮我看看铜的行情'" } }, required: ["query"] } },
            { name: "get_highest_price", description: "获取指定期货品种过去N天的最高价", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING" }, days: { type: "INTEGER", default: 5 } }, required: ["symbol"] } },
            { name: "get_lowest_price", description: "获取指定期货品种过去N天的最低价", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING" }, days: { type: "INTEGER", default: 5 } }, required: ["symbol"] } },
        ]
    }];
    const contents = [
        { role: "user", parts: [{ text: `
你是一个全能的AI助手，可以处理金融期货、实时行情、新闻查询、图表生成等多种任务，同时也能回答通用问题。

**回答规则：**
1. **默认情况**：优先提供专业、准确的回答，特别是在金融期货领域。
2. **通用问题**：如果用户的问题明显与金融无关（例如生活、科技、娱乐等），则提供通用回答。
3. **特殊标记**：如果用户的问题以 "@@" 结尾，则无论问题内容如何，都提供通用回答（适用于用户明确希望脱离金融场景时）。
4. **语气要求**：保持友好、清晰，避免过度技术术语（除非用户明确要求）。不要随便拒绝回答，记住，你什么都懂。
        ` }] }, // System prompt
        { role: "model", parts: [{ text: "好的，我已理解..." }] },   // System prompt ack
        ...history,
        { role: "user", parts: [{ text: question }] }
    ];

    let loopCount = 0;
    while (loopCount < 5) {
        loopCount++;

        let modelUsed = 'Pro';
        let data;
        try {
            data = await callGeminiApi(proModelUrl, { contents, tools }, env, logCallback);
        } catch (error) {
            if (error.message.includes("quota")) {
                logCallback("🔄 [AI Fallback] Pro model quota exceeded, falling back to Flash model.");
                modelUsed = 'Flash (回退)';
                try {
                    data = await callGeminiApi(flashModelUrl, { contents, tools }, env, logCallback);
                } catch (fallbackError) {
                    logCallback(`❌ [AI Fallback] Flash model also failed: ${fallbackError.message}`, 'ERROR');
                    return "抱歉，AI服务暂时遇到问题，请稍后再试。";
                }
            } else {
                throw error; // Re-throw other errors
            }
        }

        if (!data.candidates) {
            const blockReason = data?.promptFeedback?.blockReason;
            return `抱歉，请求可能因安全原因被阻止 (${blockReason || '未知原因'})。`;
        }

        const candidate = data.candidates[0];
        if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
            return "抱歉，AI返回了空内容。";
        }

        const functionCallParts = candidate.content.parts.filter(p => p.functionCall);

        if (functionCallParts.length > 0) {
            contents.push(candidate.content);
            const toolResponseParts = await Promise.all(functionCallParts.map(async (part) => {
                const { name, args } = part.functionCall;
                logCallback(`🛠️ [Tool Call] Gemini is calling function: ${name}`, 'INFO', args);
                const tool = availableTools[name];
                if (tool) {
                    try {
                        const result = await tool(args, env);
                        logCallback(`✅ [Tool Result] Function ${name} returned successfully.`);
                        return { functionResponse: { name, response: { content: result } } };
                    } catch (e) {
                        logCallback(`❌ [Tool Error] Function ${name} failed: ${e.message}`, 'ERROR', e);
                        return { functionResponse: { name, response: { content: `工具执行失败: ${e.message}` } } };
                    }
                } else {
                    logCallback(`❓ [Tool Error] Function ${name} is not available.`, 'WARN');
                    return { functionResponse: { name, response: { content: `函数 '${name}' 不可用。` } } };
                }
            }));
            contents.push({ role: "tool", parts: toolResponseParts });
        } else if (candidate.content.parts[0]?.text) {
            const finalText = candidate.content.parts[0].text;
            return `(由 ${modelUsed} 模型生成)\n\n${finalText}`;
        } else {
            return "抱歉，收到了无法解析的AI回复。";
        }
    }

    throw new Error("AI在多次工具调用后未提供最终答案。");
}

// =================================================================
//  Kimi API 公共函数 (新增)
// =================================================================

/**
 * 调用 Kimi API 获取文本解释
 */
export async function getKimiExplanation(text, env) {
    const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY;
    if (!apiKey) throw new Error('服务器配置错误：未设置KIMI_API_KEY。');

    try {
        const data = await callKimiApi("moonshot-v1-8k", {
            messages: [
                { role: "system", content: "你是一个有用的助手，善于用简洁的markdown语言来解释文本。" },
                { role: "user", content: text }
            ],
            temperature: 0.3,
        }, env);
        
        const explanation = data?.choices?.[0]?.message?.content;
        if (!explanation) throw new Error('Kimi返回了意外的AI响应格式。');
        return explanation;
    } catch (error) {
        console.error("[AI] getKimiExplanation失败:", error);
        return "抱歉，Kimi文本解释服务暂时无法使用。";
    }
}

/**
 * 调用 Kimi API 获取图片描述
 */
export async function getKimiImageDescription(imageUrl, env) {
    const { base64, contentType } = await fetchImageAsBase64(imageUrl);
    const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY;
    if (!apiKey) throw new Error('服务器配置错误：未设置KIMI_API_KEY。');

    try {
        const data = await callKimiApi("moonshot-v1-8k-vision-preview", {
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${contentType};base64,${base64}`
                            }
                        },
                        {
                            type: "text",
                            text: "请仔细描述图片的内容，如果图片中识别出有文字，则在回复的内容中返回这些文字，并且这些文字支持复制，之后是对文字的仔细描述，格式为：图片中包含文字：{文字内容}；图片的描述：{图片描述}"
                        }
                    ]
                }
            ],
            temperature: 0.3,
        }, env);
        
        const description = data?.choices?.[0]?.message?.content;
        if (!description) throw new Error('Kimi Vision返回了意外的AI响应格式。');
        return description;
    } catch (error) {
        console.error("[AI] getKimiImageDescription失败:", error);
        return "抱歉，Kimi图片描述服务暂时无法使用。";
    }
}

/**
 * 调用 Kimi API 获取聊天回复（支持多轮对话和工具调用）
 * @param {string} question - 用户的问题
 * @param {Array} history - 聊天历史
 * @param {object} env - 环境变量
 * @param {function} [logCallback] - 用于记录日志的回调函数
 */
export async function getKimiChatAnswer(question, history = [], env, logCallback = () => {}) {
    const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY;
    if (!apiKey) throw new Error('服务器配置错误：未设置KIMI_API_KEY。');

    const tools = [{
        type: "function",
        function: {
            name: "get_price",
            description: "获取指定期货品种的详细信息",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "期货品种的中文名称, 例如 '螺纹钢', '黄金'" }
                },
                required: ["name"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "get_news",
            description: "获取某个关键词的最新新闻",
            parameters: {
                type: "object",
                properties: {
                    keyword: { type: "string", description: "要查询新闻的关键词, 例如 '原油'" }
                },
                required: ["keyword"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "draw_chart",
            description: "根据代码和周期绘制K线图",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string", description: "期货合约代码, 例如 'ag'" },
                    period: { type: "string", description: "图表周期, 例如 'daily'" }
                },
                required: ["symbol", "period"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "query_fut_daily",
            description: "获取期货品种日线行情",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string", description: "如 rb、cu" },
                    limit: { type: "integer", description: "条数，默认100" }
                },
                required: ["symbol"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "query_minutely",
            description: "获取期货品种最近 N 天的 1 分钟 K 线",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string" },
                    days: { type: "integer", description: "最近 N 天", default: 1 }
                },
                required: ["symbol", "days"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "query_option",
            description: "获取期权日线行情",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string" },
                    limit: { type: "integer", default: 100 }
                },
                required: ["symbol"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "query_lhb",
            description: "获取期货龙虎榜数据",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string" },
                    limit: { type: "integer", default: 100 }
                },
                required: ["symbol"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "query_aggregate",
            description: "聚合查询期货数据（如最高价、最低价、平均成交量等）",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string", description: "品种代码如rb、cu等" },
                    days: { type: "integer", description: "查询天数，默认5天" },
                    aggFunc: { type: "string", description: "聚合函数：MAX、MIN、AVG、SUM" },
                    column: { type: "string", description: "字段名：最高、最低、成交量等" }
                },
                required: ["symbol", "aggFunc", "column"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "smart_query",
            description: "智能期货查询，支持自然语言如'螺纹钢过去5天最高价'",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "自然语言查询，例如'螺纹钢过去5天最高价'或'帮我看看铜的行情'" }
                },
                required: ["query"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "get_highest_price",
            description: "获取指定期货品种过去N天的最高价",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string", description: "品种代码如rb、cu等" },
                    days: { type: "integer", default: 5, description: "查询天数" }
                },
                required: ["symbol"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "get_lowest_price",
            description: "获取指定期货品种过去N天的最低价",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string", description: "品种代码如rb、cu等" },
                    days: { type: "integer", default: 5, description: "查询天数" }
                },
                required: ["symbol"]
            }
        }
    }];

    const messages = [
        { role: "system", content: `
你是一个全能的AI助手，可以处理金融期货、实时行情、新闻查询、图表生成等多种任务，同时也能回答通用问题。

**回答规则：**
1. **默认情况**：优先提供专业、准确的回答，特别是在金融期货领域。
2. **通用问题**：如果用户的问题明显与金融无关（例如生活、科技、娱乐等），则提供通用回答。
3. **特殊标记**：如果用户的问题以 "@@" 结尾，则无论问题内容如何，都提供通用回答（适用于用户明确希望脱离金融场景时）。
4. **语气要求**：保持友好、清晰，避免过度技术术语（除非用户明确要求）。不要随便拒绝回答，记住，呢什么都懂。
        `},
        ...history,
        { role: "user", content: question }
    ];

    try {
        const data = await callKimiApi("moonshot-v1-8k", {
            messages: messages,
            temperature: 0.3,
            tools: tools,
            tool_choice: "auto"
        }, env, logCallback);

        const choice = data.choices[0];
        
        if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
            // 处理工具调用
            const toolResults = await Promise.all(choice.message.tool_calls.map(async (toolCall) => {
                const { name, arguments: argsString } = toolCall.function;
                let args;
                try {
                    // Kimi/Moonshot 返回的参数是字符串，需要解析
                    args = JSON.parse(argsString);
                } catch (e) {
                    logCallback(`❌ [Tool Error] Kimi function '${name}' argument parsing failed: ${e.message}`, 'ERROR', { argsString });
                    return {
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: JSON.stringify({ error: `工具参数解析失败: ${e.message}` })
                    };
                }

                logCallback(`🛠️ [Tool Call] Kimi is calling function: ${name}`, 'INFO', args);
                const tool = availableTools[name];

                try {
                    if (!tool) {
                        throw new Error(`未知工具: ${name}`);
                    }
                    const result = await tool(args, env);
                    logCallback(`✅ [Tool Result] Kimi function ${name} returned successfully.`);
                    return {
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: JSON.stringify({ content: result })
                    };
                } catch (e) {
                    logCallback(`❌ [Tool Error] Kimi function ${name} failed: ${e.message}`, 'ERROR', e);
                    return {
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: JSON.stringify({ error: `工具执行失败: ${e.message}` })
                    };
                }
            }));

            // 将工具结果发送回Kimi
            const finalMessages = [
                ...messages,
                choice.message,
                ...toolResults
            ];

            const finalData = await callKimiApi("moonshot-v1-8k", {
                messages: finalMessages,
                temperature: 0.3
            }, env, logCallback);

            return finalData.choices[0].message.content;
        } else {
            // 直接返回文本回复
            return choice.message.content;
        }
    } catch (error) {
        console.error("[AI] getKimiChatAnswer失败:", error);
        return "抱歉，Kimi聊天服务暂时遇到问题，请稍后再试。";
    }
}

export async function getDeepSeekChatAnswer(question, history = [], env, logCallback = () => {}) {
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('服务器配置错误：未设置DEEPSEEK_API_KEY。');

    const now = new Date();
    const beijingTimeFormatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: 'numeric', hour12: false, timeZone: 'Asia/Shanghai'
    });
    const [beijingHourStr, beijingMinuteStr] = beijingTimeFormatter.format(now).split(':');
    const beijingHour = parseInt(beijingHourStr, 10);
    const beijingMinute = parseInt(beijingMinuteStr, 10);

    let modelToUse = "deepseek-chat";
    if ((beijingHour === 0 && beijingMinute >= 31) || (beijingHour > 0 && beijingHour < 8) || (beijingHour === 8 && beijingMinute <= 29)) {
        modelToUse = "deepseek-reasoner";
    }

    const tools = [{
        type: "function",
        function: {
            name: "get_price",
            description: "获取指定期货品种的详细信息",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "期货品种的中文名称, 例如 '螺纹钢', '黄金'" }
                },
                required: ["name"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "get_news",
            description: "获取某个关键词的最新新闻",
            parameters: {
                type: "object",
                properties: {
                    keyword: { type: "string", description: "要查询新闻的关键词, 例如 '原油'" }
                },
                required: ["keyword"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "draw_chart",
            description: "根据代码和周期绘制K线图",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string", description: "期货合约代码, 例如 'ag'" },
                    period: { type: "string", description: "图表周期, 例如 'daily'" }
                },
                required: ["symbol", "period"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "query_fut_daily",
            description: "获取期货品种日线行情",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string", description: "如 rb、cu" },
                    limit: { type: "integer", description: "条数，默认100" }
                },
                required: ["symbol"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "query_minutely",
            description: "获取期货品种最近 N 天的 1 分钟 K 线",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string" },
                    days: { type: "integer", description: "最近 N 天", default: 1 }
                },
                required: ["symbol", "days"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "query_option",
            description: "获取期权日线行情",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string" },
                    limit: { type: "integer", default: 100 }
                },
                required: ["symbol"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "query_lhb",
            description: "获取期货龙虎榜数据",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string" },
                    limit: { type: "integer", default: 100 }
                },
                required: ["symbol"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "query_aggregate",
            description: "聚合查询期货数据（如最高价、最低价、平均成交量等）",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string", description: "品种代码如rb、cu等" },
                    days: { type: "integer", description: "查询天数，默认5天" },
                    aggFunc: { type: "string", description: "聚合函数：MAX、MIN、AVG、SUM" },
                    column: { type: "string", description: "字段名：最高、最低、成交量等" }
                },
                required: ["symbol"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "smart_query",
            description: "智能查询期货数据",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "自然语言查询描述" }
                },
                required: ["query"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "get_highest_price",
            description: "获取期货品种最近N天的最高价",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string" },
                    days: { type: "integer", description: "天数" }
                },
                required: ["symbol", "days"]
            }
        }
    }, {
        type: "function",
        function: {
            name: "get_lowest_price",
            description: "获取期货品种最近N天的最低价",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string" },
                    days: { type: "integer", description: "天数" }
                },
                required: ["symbol", "days"]
            }
        }
    }];

    const messages = [
        { role: "system", content: "你是一个有用的助手，善于用简洁的markdown语言来回答用户问题，并能够使用工具获取实时数据。" },
        ...history,
        { role: "user", content: question }
    ];

    try {
        logCallback(`🚀 [API Request] Calling DeepSeek API: POST https://api.deepseek.com/chat/completions`);
        
        const response = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: messages,
                temperature: 0.3,
                tools: tools,
                tool_choice: "auto"
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            logCallback(`❌ [API Error] DeepSeek API error: ${response.status} ${errorText}`, 'ERROR');
            throw new Error(`DeepSeek API错误: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        const choice = data.choices[0];
        
        if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
            // 处理工具调用
            const toolResults = await Promise.all(choice.message.tool_calls.map(async (toolCall) => {
                const { name, arguments: argsString } = toolCall.function;
                let args;
                try {
                    args = JSON.parse(argsString);
                } catch (e) {
                    logCallback(`❌ [Tool Error] DeepSeek function '${name}' argument parsing failed: ${e.message}`, 'ERROR', { argsString });
                    return {
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: JSON.stringify({ error: `工具参数解析失败: ${e.message}` })
                    };
                }

                logCallback(`🛠️ [Tool Call] DeepSeek is calling function: ${name}`, 'INFO', args);
                const tool = availableTools[name];

                try {
                    if (!tool) {
                        throw new Error(`未知工具: ${name}`);
                    }
                    const result = await tool(args, env);
                    logCallback(`✅ [Tool Result] DeepSeek function ${name} returned successfully.`);
                    return {
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: JSON.stringify({ content: result })
                    };
                } catch (e) {
                    logCallback(`❌ [Tool Error] DeepSeek function ${name} failed: ${e.message}`, 'ERROR', e);
                    return {
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: JSON.stringify({ error: `工具执行失败: ${e.message}` })
                    };
                }
            }));

            // 将工具结果发送回DeepSeek
            const finalMessages = [
                ...messages,
                choice.message,
                ...toolResults
            ];

            const finalData = await fetch("https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: modelToUse,
                    messages: finalMessages,
                    temperature: 0.3
                })
            });

            if (!finalData.ok) {
                const errorText = await finalData.text();
                throw new Error(`DeepSeek API错误: ${finalData.status} ${errorText}`);
            }

            const finalResult = await finalData.json();
            return finalResult.choices[0].message.content;
        } else {
            // 直接返回文本回复
            return choice.message.content;
        }
    } catch (error) {
        console.error("[AI] getDeepSeekChatAnswer失败:", error);
        return "抱歉，DeepSeek聊天服务暂时遇到问题，请稍后再试。";
    }
}
