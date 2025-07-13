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

const systemInstruction = {
        role: "user",
        parts: [{
            text: "你是一个全能的AI助手。你的主要能力是作为金融期货助手，可以使用工具查询价格、新闻和绘制图表。但是，如果用户的问题与金融无关，你也应该利用你的通用知识库来回答，而不是拒绝。请始终友好、乐于助人地回答所有类型的问题。"
        }]
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

    const flashModelApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const proModelApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;

    const tools = [{
        functionDeclarations: [
            // ... (tool definitions remain the same)
            { name: "get_price", description: "获取指定期货合约的详细信息...", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING", description: "期货合约代码..." } }, required: ["symbol"] } },
            { name: "get_news", description: "获取关于某个关键词的最新新闻", parameters: { type: "OBJECT", properties: { keyword: { type: "STRING", description: "要查询新闻的关键词..." } }, required: ["keyword"] } },
            { name: "draw_chart", description: "根据指定的合约代码和周期绘制K线图", parameters: { type: "OBJECT", properties: { symbol: { type: "STRING", description: "期货合约代码..." }, period: { type: "STRING", description: "图表周期..." } }, required: ["symbol", "period"] } }
        ]
    }];

    const contents = [
        { role: "user", parts: [{ text: "你是一个全能的AI助手。你的主要能力是作为金融期货助手，可以使用工具查询价格、新闻和绘制图表。但是，如果用户的问题与金融无关，你也应该利用你的通用知识库来回答，而不是拒绝。请始终友好、乐于助人地回答所有类型的问题。"  }] },
        { role: "model", parts: [{ text: "好的，我已理解我的角色和能力范围..." }] },
        ...history, 
        { role: "user", parts: [{ text: question }] }
    ];

    // --- Stage 1: Initial check with Flash model ---
    console.log("[AI] Stage 1: Checking with Flash model.");
    const initialResponse = await fetch(flashModelApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents, tools })
    });

    if (!initialResponse.ok) throw new Error(`Gemini API error (Flash): ${await initialResponse.text()}`);
    const initialData = await initialResponse.json();
    const initialCandidate = initialData?.candidates?.[0];
    if (!initialCandidate || !initialCandidate.content || !initialCandidate.content.parts) {
        throw new Error('Unexpected AI response format from Gemini (Flash).');
    }

    const initialPart = initialCandidate.content.parts[0];

    if (initialPart.text) {
        // Simple case: Flash model provided a direct answer.
        console.log("[AI] Flash model provided a direct answer. Returning.");
        return initialPart.text;
    }

    if (!initialPart.functionCall) {
        // Unexpected response, but might contain text.
        throw new Error('Unhandled AI response from Flash model.');
    }

    // --- Stage 2: Handover to Pro model for tool calls ---
    console.log("[AI] Stage 2: Flash requested a tool. Handing over to Pro model.");
    contents.push(initialCandidate.content); // Add Flash's function call request to history

    let currentApiUrl = proModelApiUrl;
    let loopCount = 0;
    while (loopCount < 5) {
        loopCount++;

        // The first iteration will use the function call from Flash
        // Subsequent iterations will generate their own function calls using Pro
        const response = await fetch(currentApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents, tools })
        });

        if (!response.ok) throw new Error(`Gemini API error (Pro): ${await response.text()}`);
        const data = await response.json();
        const candidate = data?.candidates?.[0];
        if (!candidate || !candidate.content || !candidate.content.parts) {
            throw new Error('Unexpected AI response format from Gemini (Pro).');
        }

        const part = candidate.content.parts[0];

        if (part.functionCall) {
            const { name, args } = part.functionCall;
            console.log(`[AI Pro] Wants to call function: ${name} with args:`, args);

            const tool = availableTools[name];
            if (tool) {
                let result;
                if (name === 'draw_chart') {
                    result = await tool(env, ...Object.values(args));
                } else {
                    result = await tool(...Object.values(args));
                }
                
                contents.push(candidate.content); // Add Pro's function call request
                contents.push({
                    role: "tool",
                    parts: [{ functionResponse: { name, response: { content: result } } }]
                });
            } else {
                console.log(`[AI Pro] Function '${name}' is not available. Informing the model.`);
                contents.push(candidate.content);
                contents.push({
                    role: "tool",
                    parts: [{ functionResponse: { name, response: { content: `函数 '${name}' 不可用。请直接回答用户的问题。` } } }]
                });
            }
        } else if (part.text) {
            return part.text;
        } else {
            throw new Error('Unhandled AI response part type from Pro model.');
        }
    }

    throw new Error("AI (Pro) did not provide a final answer after multiple tool calls.");
}
