// src/ai.js

import { getPrice } from './futuresDataService.js';
import { getNews } from './newsService.js';
import { drawChart } from './chart_generator.js';

// 绑定AI可用的工具函数
const availableTools = {
    get_price: getPrice,
    get_news: getNews,
    draw_chart: drawChart,
};

// =================================================================
//  Kimi API 调用函数 (新增)
// =================================================================
/**
 * 调用Kimi API的函数，兼容OpenAI接口格式
 * @param {string} model - 要调用的模型名称
 * @param {object} payload - 发送给API的请求体
 * @param {object} env - 环境变量，包含KIMI_API_KEY
 * @returns {Promise<object>} - 返回API的JSON响应
 * @throws {Error} - 如果调用失败，则抛出错误
 */
async function callKimiApi(model, payload, env) {
    const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY;
    if (!apiKey) {
        throw new Error('Server config error: No KIMI_API_KEY is set.');
    }

    const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
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
        throw new Error(`Kimi API error: ${errorText}`);
    }

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
 * @returns {Promise<object>} - 返回API的JSON响应。
 * @throws {Error} - 如果所有尝试都失败，则抛出错误。
 */
async function callGeminiApi(modelUrl, payload, env) {
    const keys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY2,env.GEMINI_API_KEY3].filter(Boolean);
    if (keys.length === 0) {
        throw new Error('Server config error: No GEMINI_API_KEY is set.');
    }

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const urlWithKey = `${modelUrl}?key=${key}`;
        
        try {
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
                console.log(`[AI] API Key ${i + 1} quota exceeded. Trying next key.`);
                continue; 
            }
            
            // 对于其他错误或这是最后一个密钥，则直接抛出错误
            throw new Error(`Gemini API error (Key ${i + 1}): ${errorText}`);

        } catch (error) {
            // 如果是网络错误等，并且还有其他密钥，也尝试下一个
            if (i < keys.length - 1) {
                console.error(`[AI] Error with API Key ${i + 1}:`, error.message, "Trying next key.");
                continue;
            }
            // 这是最后一个密钥了，重新抛出错误
            throw error;
        }
    }
    // 如果所有密钥都因配额问题失败，则抛出最终错误
    throw new Error("All available Gemini API keys have exceeded their quota.");
}

// =================================================================
//  导出的公共函数 (保持接口不变)
// =================================================================

/**
 * 调用 DeepSeek API 获取文本解释。
 */
export async function getDeepSeekExplanation(text, env) {
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('Server config error: DEEPSEEK_API_KEY is not set.');

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

    if (!response.ok) throw new Error(`DeepSeek API error: ${await response.text()}`);
    const data = await response.json();
    const explanation = data?.choices?.[0]?.message?.content;
    if (!explanation) throw new Error('Unexpected AI response format from DeepSeek.');
    return explanation;
}

/**
 * 【修正版】从URL获取图片并高效地转换为Base64编码。
 */
async function fetchImageAsBase64(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return { base64, contentType };
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
        if (!description) throw new Error('Unexpected AI response format from Gemini Vision.');
        return description;
    } catch (error) {
        console.error("[AI] getGeminiImageDescription failed:", error);
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
        if (!explanation) throw new Error('Unexpected AI response format from Gemini.');
        return explanation;
    } catch (error) {
        console.error("[AI] getGeminiExplanation failed:", error);
        return "抱歉，文本解释服务暂时无法使用。";
    }
}


/**
 * 调用 Google Gemini API 获取聊天回复（支持多轮函数调用）。
 */
export async function getGeminiChatAnswer(question, history = [], env) {
    const flashModelUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
    const proModelUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`;

    const tools = [{
        functionDeclarations: [
            { name: "get_price", description: "获取指定期货品种的详细信息", parameters: { type: "OBJECT", properties: { name: { type: "STRING", description: "期货品种的中文名称, 例如 '螺纹钢', '黄金'" } }, required: ["name"] } },
            { name: "get_news", description: "获取某个关键词的最新新闻", parameters: { type: "OBJECT", properties: { keyword: { type: "STRING", description: "要查询新闻的关键词, 例如 '原油'" } }, required: ["keyword"] } },
            { name: "draw_chart", description: "根据代码和周期绘制K线图", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING", description: "期货合约代码, 例如 'ag'" }, period: { type: "STRING", description: "图表周期, 例如 'daily'" } }, required: ["symbol", "period"] } }
        ]
    }];

    const contents = [
        { role: "user", parts: [{ text: "你是一个全能的AI助手..." }] }, // System prompt
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
            data = await callGeminiApi(proModelUrl, { contents, tools }, env);
        } catch (error) {
            if (error.message.includes("quota")) {
                console.log("[AI] Pro model failed, falling back to Flash for this turn.");
                modelUsed = 'Flash (Fallback)';
                try {
                    data = await callGeminiApi(flashModelUrl, { contents, tools }, env);
                } catch (fallbackError) {
                    console.error("[AI] Flash fallback also failed:", fallbackError);
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
                console.log(`[AI] Calling tool: ${name} with args:`, args);
                const tool = availableTools[name];
                if (tool) {
                    try {
                        let result;
                        switch (name) {
                            case 'get_price': result = await getPrice(args.name); break;
                            case 'get_news': result = await getNews(args.keyword); break;
                            case 'draw_chart': result = await drawChart(env, args.symbol, args.period); break;
                            default: throw new Error(`Unknown tool: ${name}`);
                        }
                        return { functionResponse: { name, response: { content: result } } };
                    } catch (e) {
                        console.error(`[AI] Error executing tool '${name}':`, e);
                        return { functionResponse: { name, response: { content: `工具执行失败: ${e.message}` } } };
                    }
                } else {
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

    throw new Error("AI did not provide a final answer after multiple tool calls.");
}

// =================================================================
//  Kimi API 公共函数 (新增)
// =================================================================

/**
 * 调用 Kimi API 获取文本解释
 */
export async function getKimiExplanation(text, env) {
    const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY;
    if (!apiKey) throw new Error('Server config error: No KIMI_API_KEY is set.');

    try {
        const data = await callKimiApi("moonshot-v1-8k", {
            messages: [
                { role: "system", content: "你是一个有用的助手，善于用简洁的markdown语言来解释文本。" },
                { role: "user", content: text }
            ],
            temperature: 0.3,
        }, env);
        
        const explanation = data?.choices?.[0]?.message?.content;
        if (!explanation) throw new Error('Unexpected AI response format from Kimi.');
        return explanation;
    } catch (error) {
        console.error("[AI] getKimiExplanation failed:", error);
        return "抱歉，Kimi文本解释服务暂时无法使用。";
    }
}

/**
 * 调用 Kimi API 获取图片描述
 */
export async function getKimiImageDescription(imageUrl, env) {
    const { base64, contentType } = await fetchImageAsBase64(imageUrl);
    const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY;
    if (!apiKey) throw new Error('Server config error: No KIMI_API_KEY is set.');

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
        if (!description) throw new Error('Unexpected AI response format from Kimi Vision.');
        return description;
    } catch (error) {
        console.error("[AI] getKimiImageDescription failed:", error);
        return "抱歉，Kimi图片描述服务暂时无法使用。";
    }
}

/**
 * 调用 Kimi API 获取聊天回复（支持多轮对话和工具调用）
 */
export async function getKimiChatAnswer(question, history = [], env) {
    const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY;
    if (!apiKey) throw new Error('Server config error: No KIMI_API_KEY is set.');

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
    }];

    const messages = [
        { role: "system", content: "你是一个全能的AI助手，专门帮助用户解答期货相关问题。你可以获取实时行情、最新新闻和生成图表。请用中文回答，并保持回答简洁明了。" },
        ...history,
        { role: "user", content: question }
    ];

    try {
        const data = await callKimiApi("moonshot-v1-8k", {
            messages: messages,
            temperature: 0.3,
            tools: tools,
            tool_choice: "auto"
        }, env);

        const choice = data.choices[0];
        
        if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
            // 处理工具调用
            const toolResults = await Promise.all(choice.message.tool_calls.map(async (toolCall) => {
                const { name, arguments: args } = toolCall.function;
                console.log(`[AI] Kimi calling tool: ${name} with args:`, args);
                
                try {
                    let result;
                    switch (name) {
                        case 'get_price': result = await getPrice(args.name); break;
                        case 'get_news': result = await getNews(args.keyword); break;
                        case 'draw_chart': result = await drawChart(env, args.symbol, args.period); break;
                        default: throw new Error(`Unknown tool: ${name}`);
                    }
                    return {
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: JSON.stringify({ content: result })
                    };
                } catch (e) {
                    console.error(`[AI] Error executing Kimi tool '${name}':`, e);
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
            }, env);

            return finalData.choices[0].message.content;
        } else {
            // 直接返回文本回复
            return choice.message.content;
        }
    } catch (error) {
        console.error("[AI] getKimiChatAnswer failed:", error);
        return "抱歉，Kimi聊天服务暂时遇到问题，请稍后再试。";
    }
}
