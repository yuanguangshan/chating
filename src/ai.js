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

/**
 * 调用 Google Gemini API 获取文本解释。(Restored for /ai-explain endpoint)
 */
export async function getGeminiExplanation(text, env) {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Server config error: GEMINI_API_KEY is not set.');
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
    const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: text }] }]
        })
    });
    if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`);
    const data = await response.json();
    const explanation = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!explanation) throw new Error('Unexpected AI response format from Gemini.');
    return explanation;
}


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
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Server config error: GEMINI_API_KEY is not set.');

    const { base64, contentType } = await fetchImageAsBase64(imageUrl);
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
    const prompt = "请仔细描述图片的内容，如果图片中识别出有文字，则在回复的内容中返回这些文字，并且这些文字支持复制，之后是对文字的仔细描述，格式为：图片中包含文字：{文字内容}；图片的描述：{图片描述}";

    const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: contentType, data: base64 } }] }]
        })
    });
    if (!response.ok) throw new Error(`Gemini Vision API error: ${await response.text()}`);
    const data = await response.json();
    const description = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!description) throw new Error('Unexpected AI response format from Gemini Vision.');
    return description;
}

/**
 * 调用 Google Gemini API 获取聊天回复（支持多轮函数调用）。
 * @param {string} question - The user's latest question.
 * @param {Array} history - The conversation history.
 * @param {object} env - The environment variables.
 * @returns {string} The AI's final text answer.
 */
export async function getGeminiChatAnswer(question, history = [], env) {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Server config error: GEMINI_API_KEY is not set.');

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;

    // 1. 定义AI可以调用的工具
    const tools = [{
        functionDeclarations: [
            {
                name: "get_price",
                description: "获取指定期货合约的详细信息，包括最新价(price)、今日涨跌幅(change_percent)、5日涨幅(zdf5)、20日涨幅(zdf20)、年初至今涨幅(zdfly)、250日涨幅(zdf250)、成交量(volume)和成交额(amount)",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        symbol: { type: "STRING", description: "期货合约代码, 例如 'rb' (螺纹钢), 'au' (黄金)" }
                    },
                    required: ["symbol"]
                }
            },
            {
                name: "get_news",
                description: "获取关于某个关键词的最新新闻",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        keyword: { type: "STRING", description: "要查询新闻的关键词, 例如 '原油'" }
                    },
                    required: ["keyword"]
                }
            },
            {
                name: "draw_chart",
                description: "根据指定的合约代码和周期绘制K线图",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        symbol: { type: "STRING", description: "期货合约代码, 例如 'ag' (白银)" },
                        period: { type: "STRING", description: "图表周期, 例如 '5d' (5日), '1h' (1小时), 'daily' (日线)" }
                    },
                    required: ["symbol", "period"]
                }
            }
        ]
    }];

    // 2. 构建请求历史
    const contents = [...history, { role: "user", parts: [{ text: question }] }];

    // 3. 进入与AI的多轮交互循环
    let loopCount = 0;
    while (loopCount < 5) { // 防止无限循环
        loopCount++;

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents, tools })
        });

        if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`);
        const data = await response.json();
        
        const candidate = data?.candidates?.[0];
        if (!candidate || !candidate.content || !candidate.content.parts) {
            throw new Error('Unexpected AI response format from Gemini.');
        }

        const part = candidate.content.parts[0];

        // 4. 判断AI的回复类型
        if (part.functionCall) {
            // AI请求调用工具
            const { name, args } = part.functionCall;
            console.log(`[AI] Wants to call function: ${name} with args:`, args);

            const tool = availableTools[name];
            if (tool) {
                // 执行本地函数
                // Gemini的参数是 {symbol: 'rb', period: '5d'}
                // 我们需要将它传递给我们的函数 drawChart(env, symbol, period)
                // 因此，我们需要把 env 对象也传进去
                let result;
                if (name === 'draw_chart') {
                    result = await tool(env, ...Object.values(args));
                } else {
                    result = await tool(...Object.values(args));
                }
                
                // 将函数执行结果告诉AI
                contents.push({ role: "model", parts: [part] }); // 先把AI的调用请求存入历史
                contents.push({
                    role: "tool",
                    parts: [{ functionResponse: { name, response: { content: result } } }]
                });
                // 继续循环，让AI根据函数结果生成最终回复
            } else {
                // 如果AI试图调用一个我们未定义的函数，我们不应该抛出错误或重新请求。
                // 相反，我们应该在对话历史中明确地告诉AI这个函数不可用，
                // 然后让它在下一次迭代中自己决定如何回复。
                console.log(`[AI] Function '${name}' is not available. Informing the model.`);
                
                // 1. 将AI的无效函数调用请求添加到历史记录中
                contents.push({ role: "model", parts: [part] }); 
                
                // 2. 添加一个工具角色的响应，告知函数不存在，并指示AI直接回答
                contents.push({
                    role: "tool",
                    parts: [{ 
                        functionResponse: { 
                            name, 
                            response: { 
                                content: `函数 '${name}' 不可用。请不要尝试调用任何未明确提供的函数。请根据现有信息直接回答用户的问题。` 
                            } 
                        } 
                    }]
                });
                // 循环将继续，AI会看到这个反馈并生成文本回复。
            }
        } else if (part.text) {
            // AI直接返回了文本，交互结束
            return part.text;
        } else {
            throw new Error('Unhandled AI response part type.');
        }
    }

    throw new Error("AI did not provide a final answer after multiple tool calls.");
}
