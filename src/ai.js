// src/ai.js (完整重构版)

import { getPrice } from "./futuresDataService.js";
import { getNews } from "./newsService.js";
import { drawChart } from "./chart_generator.js";
import * as fq from "./futuresToolkit.js";
import { smartQuery } from "./dataApiService.js";

// =================================================================
//  1. 工具实现 (Tool Implementations)
// =================================================================
// 将所有可用的工具函数映射到一个对象中，方便按名称调用。
const availableTools = {
  get_price: (args) => getPrice(args.name),
  get_news: (args) => getNews(args.keyword),
  draw_chart: (args, env) => drawChart(env, args.symbol, args.period),
  query_fut_daily: (args) => fq.queryFuturesDaily(args.symbol, args.limit),
  query_minutely: (args) => fq.queryMinutelyHistory(args.symbol, args.days),
  query_option: (args) => fq.queryOptionQuote(args.symbol, args.limit),
  query_lhb: (args) => fq.queryLHB(args.symbol, args.limit),
  query_aggregate: (args) =>
    fq.queryAggregate(args.symbol, args.days, args.aggFunc, args.column),
  smart_query: (args) => fq.smartQuery(args.query),
  get_highest_price: (args) => fq.getHighestPrice(args.symbol, args.days),
  get_lowest_price: (args) => fq.getLowestPrice(args.symbol, args.days),
};

// =================================================================
//  2. 公共定义与格式化器 (Common Definitions & Formatters)
// =================================================================

// AI 用户名列表，用于区分用户和AI模型的角色
const KNOWN_AI_USERNAMES = ["Gemini", "Kimi", "DeepSeek", "机器人小助手"];

// --- 主工具定义 (唯一的“事实来源”) ---
const MASTER_TOOL_DEFINITIONS = [
  {
    name: "get_price",
    description: "获取指定期货品种的详细信息",
    parameters: {
      type: "OBJECT",
      properties: {
        name: {
          type: "STRING",
          description: "期货品种的中文名称, 例如 '螺纹钢', '黄金'",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_news",
    description: "获取某个关键词的最新新闻",
    parameters: {
      type: "OBJECT",
      properties: {
        keyword: {
          type: "STRING",
          description: "要查询新闻的关键词, 例如 '原油'",
        },
      },
      required: ["keyword"],
    },
  },
  {
    name: "draw_chart",
    description: "根据代码和周期绘制K线图",
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: { type: "STRING", description: "期货合约代码, 例如 'ag'" },
        period: { type: "STRING", description: "图表周期, 例如 'daily'" },
      },
      required: ["symbol", "period"],
    },
  },
  {
    name: "query_fut_daily",
    description: "获取期货品种日线行情",
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: { type: "STRING", description: "如 rb、cu" },
        limit: { type: "INTEGER", description: "条数，默认100" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "query_minutely",
    description: "获取期货品种最近 N 天的 1 分钟 K 线",
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: { type: "STRING" },
        days: { type: "INTEGER", description: "最近 N 天", default: 1 },
      },
      required: ["symbol", "days"],
    },
  },
  {
    name: "query_option",
    description: "获取期权日线行情",
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: { type: "STRING" },
        limit: { type: "INTEGER", default: 100 },
      },
      required: ["symbol"],
    },
  },
  {
    name: "query_lhb",
    description: "获取期货龙虎榜数据",
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: { type: "STRING" },
        limit: { type: "INTEGER", default: 100 },
      },
      required: ["symbol"],
    },
  },
  {
    name: "query_aggregate",
    description: "聚合查询期货数据（如最高价、最低价、平均成交量等）",
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: { type: "STRING", description: "品种代码如rb、cu等" },
        days: { type: "INTEGER", description: "查询天数，默认5天" },
        aggFunc: {
          type: "STRING",
          description: "聚合函数：MAX、MIN、AVG、SUM",
        },
        column: { type: "STRING", description: "字段名：最高、最低、成交量等" },
      },
      required: ["symbol", "aggFunc", "column"],
    },
  },
  {
    name: "smart_query",
    description: "智能期货查询，支持自然语言如'螺纹钢过去5天最高价'",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description:
            "自然语言查询，例如'螺纹钢过去5天最高价'或'帮我看看铜的行情'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_highest_price",
    description: "获取指定期货品种过去N天的最高价",
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: { type: "STRING" },
        days: { type: "INTEGER", default: 5 },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_lowest_price",
    description: "获取指定期货品种过去N天的最低价",
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: { type: "STRING" },
        days: { type: "INTEGER", default: 5 },
      },
      required: ["symbol"],
    },
  },
];

/**
 * ✅ 新增辅助函数：递归地将JSON Schema中的类型转换为小写。
 * @param {object} schema - 输入的JSON Schema对象。
 * @returns {object} - 转换后的新对象。
 */
function convertSchemaTypesToLowercase(schema) {
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map((item) => convertSchemaTypesToLowercase(item));
  }
  const newSchema = {};
  for (const key in schema) {
    if (key === "type" && typeof schema[key] === "string") {
      newSchema[key] = schema[key].toLowerCase();
    } else {
      newSchema[key] = convertSchemaTypesToLowercase(schema[key]);
    }
  }
  return newSchema;
}

/**
 * 将主工具列表格式化为 Gemini API 接受的格式。
 * @returns {object} 格式化后的工具对象
 */
function formatToolsForGemini() {
  return [{ functionDeclarations: MASTER_TOOL_DEFINITIONS }];
}

/**
 * 将主工具列表格式化为 OpenAI 兼容 API (Kimi, DeepSeek) 接受的格式。
 * @returns {Array<object>} 格式化后的工具数组
 */
/**
 * ✅ 已修正：现在会正确转换类型为小写。
 */
function formatToolsForOpenAI() {
  return MASTER_TOOL_DEFINITIONS.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      // 关键修正：调用新函数来转换参数的 schema
      parameters: convertSchemaTypesToLowercase(tool.parameters),
    },
  }));
}

/**
 * 将内部历史记录格式化为 Gemini API 接受的格式。
 * @param {Array} history - 聊天室内部历史记录
 * @returns {Array} 格式化后的历史记录
 */
function formatHistoryForGemini(history) {
  if (!history) return [];
  return history
    .filter((msg) => msg && typeof msg.text === "string")
    .map((msg) => {
      const role = KNOWN_AI_USERNAMES.includes(msg.username) ? "model" : "user";
      return { role, parts: [{ text: msg.text }] };
    });
}

/**
 * 将内部历史记录格式化为 OpenAI 兼容 API (Kimi, DeepSeek) 接受的格式。
 * @param {Array} history - 聊天室内部历史记录
 * @returns {Array} 格式化后的历史记录
 */
function formatHistoryForOpenAI(history) {
  if (!history) return [];
  return history
    .filter((msg) => msg && typeof msg.text === "string")
    .map((msg) => {
      const role = KNOWN_AI_USERNAMES.includes(msg.username)
        ? "assistant"
        : "user";
      return { role, content: msg.text };
    });
}

// =================================================================
//  3. 核心 API 调用器 (Core API Callers)
// =================================================================

async function callKimiApi(model, payload, env, logCallback = () => {}) {
  const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY;
  if (!apiKey) throw new Error("服务器配置错误：未设置KIMI_API_KEY。");
  const url = "https://api.moonshot.cn/v1/chat/completions";
  logCallback(`🚀 [API Request] Calling Kimi API: POST ${url}`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, ...payload }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `[AI] Kimi API调用失败，状态码 ${response.status}: ${errorText}`
    );
    throw new Error(`Kimi API错误: ${errorText}`);
  }
  console.log(`[AI] Kimi API调用成功。`);
  return await response.json();
}

async function callGeminiApi(modelUrl, payload, env, logCallback = () => {}) {
  const keys = [
    env.GEMINI_API_KEY,
    env.GEMINI_API_KEY2,
    env.GEMINI_API_KEY3,
  ].filter(Boolean);
  if (keys.length === 0)
    throw new Error("服务器配置错误：未设置GEMINI_API_KEY。");
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const urlWithKey = `${modelUrl}?key=${key}`;
    try {
      logCallback(
        `🚀 [API Request] Calling Gemini API: POST ${modelUrl} (Key ${i + 1})`
      );
      const response = await fetch(urlWithKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) return await response.json();
      const errorText = await response.text();
      if (
        response.status === 429 &&
        errorText.includes("RESOURCE_EXHAUSTED") &&
        i < keys.length - 1
      ) {
        console.log(`[AI] API密钥 ${i + 1} 配额已用尽，正在尝试下一个密钥。`);
        continue;
      }
      throw new Error(`Gemini API错误 (密钥 ${i + 1}): ${errorText}`);
    } catch (error) {
      if (i < keys.length - 1) {
        console.error(
          `[AI] API密钥 ${i + 1} 出错:`,
          error.message,
          "正在尝试下一个密钥。"
        );
        continue;
      }
      console.error(
        `[AI] 所有Gemini API密钥均失败或最后一个密钥失败:`,
        error.message
      );
      throw error;
    }
  }
  console.error("[AI] 所有可用的Gemini API密钥配额均已用尽。");
  throw new Error("所有可用的Gemini API密钥配额均已用尽。");
}

async function fetchImageAsBase64(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error(
        `[AI] 从 ${imageUrl} 获取图片失败: ${response.status} ${response.statusText}`
      );
      throw new Error(
        `获取图片失败: ${response.status} ${response.statusText}`
      );
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    console.log(`[AI] 图片已获取并转换为Base64: ${imageUrl}`);
    return { base64, contentType };
  } catch (e) {
    console.error(
      `[AI] 获取或转换图片 ${imageUrl} 为Base64时出错: ${e.message}`,
      e
    );
    throw e;
  }
}

// =================================================================
//  4. 导出的公共函数 (Exported Public Functions)
// =================================================================

// --- 非聊天类函数 ---

export async function getDeepSeekExplanation(text, env) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("服务器配置错误：未设置DEEPSEEK_API_KEY。");
  const now = new Date();
  const beijingTimeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
  const [beijingHourStr, beijingMinuteStr] = beijingTimeFormatter
    .format(now)
    .split(":");
  const beijingHour = parseInt(beijingHourStr, 10);
  const beijingMinute = parseInt(beijingMinuteStr, 10);
  let modelToUse =
    (beijingHour === 0 && beijingMinute >= 31) ||
    (beijingHour > 0 && beijingHour < 8) ||
    (beijingHour === 8 && beijingMinute <= 29)
      ? "deepseek-coder"
      : "deepseek-chat";
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelToUse,
      messages: [
        {
          role: "system",
          content: "你是一个有用的，善于用简洁的markdown语言来解释下面的文本.",
        },
        { role: "user", content: text },
      ],
      temperature: 0.8,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[AI] DeepSeek API错误: ${errorText}`);
    throw new Error(`DeepSeek API错误: ${errorText}`);
  }
  const data = await response.json();
  const explanation = data?.choices?.[0]?.message?.content;
  if (!explanation) {
    console.error("[AI] DeepSeek返回了意外的AI响应格式:", data);
    throw new Error("DeepSeek返回了意外的AI响应格式。");
  }
  console.log(`[AI] DeepSeek解释已生成。`);
  return explanation;
}

export async function getGeminiImageDescription(imageUrl, env) {
  const { base64, contentType } = await fetchImageAsBase64(imageUrl);
  const proModelUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`;
  const prompt =
    "请仔细描述图片的内容，如果图片中识别出有文字，则在回复的内容中返回这些文字，并且这些文字支持复制，之后是对文字的仔细描述，格式为：图片中包含文字：{文字内容}；图片的描述：{图片描述}";
  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: contentType, data: base64 } },
        ],
      },
    ],
  };
  try {
    const data = await callGeminiApi(proModelUrl, payload, env);
    const description = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!description) {
      console.error("[AI] Gemini Vision返回了意外的AI响应格式:", data);
      throw new Error("Gemini Vision返回了意外的AI响应格式。");
    }
    console.log(`[AI] Gemini图片描述已生成。`);
    return description;
  } catch (error) {
    console.error("[AI] getGeminiImageDescription失败:", error);
    return "抱歉，图片描述服务暂时无法使用。";
  }
}

export async function getGeminiExplanation(text, env) {
  const proModelUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`;
  const payload = { contents: [{ parts: [{ text }] }] };
  try {
    const data = await callGeminiApi(proModelUrl, payload, env);
    const explanation = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!explanation) {
      console.error("[AI] Gemini Explanation返回了意外的AI响应格式:", data);
      throw new Error("Gemini返回了意外的AI响应格式。");
    }
    console.log(`[AI] Gemini解释已生成。`);
    return explanation;
  } catch (error) {
    console.error("[AI] getGeminiExplanation失败:", error);
    return "抱歉，文本解释服务暂时无法使用。";
  }
}

export async function getKimiExplanation(text, env) {
  try {
    const data = await callKimiApi(
      "moonshot-v1-8k",
      {
        messages: [
          {
            role: "system",
            content: "你是一个有用的助手，善于用简洁的markdown语言来解释文本。",
          },
          { role: "user", content: text },
        ],
        temperature: 0.3,
      },
      env
    );
    const explanation = data?.choices?.[0]?.message?.content;
    if (!explanation) throw new Error("Kimi返回了意外的AI响应格式。");
    return explanation;
  } catch (error) {
    console.error("[AI] getKimiExplanation失败:", error);
    return "抱歉，Kimi文本解释服务暂时无法使用。";
  }
}

export async function getKimiImageDescription(imageUrl, env) {
  const { base64, contentType } = await fetchImageAsBase64(imageUrl);
  try {
    const data = await callKimiApi(
      "kimi-k2-0711-preview",
      {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${contentType};base64,${base64}` },
              },
              {
                type: "text",
                text: "请仔细描述图片的内容，如果图片中识别出有文字，则在回复的内容中返回这些文字，并且这些文字支持复制，之后是对文字的仔细描述，格式为：图片中包含文字：{文字内容}；图片的描述：{图片描述}",
              },
            ],
          },
        ],
        temperature: 0.3,
      },
      env
    );
    const description = data?.choices?.[0]?.message?.content;
    if (!description)
      throw new Error("Kimi Vision返回了意外的AI响应格式,请确认。");
    return description;
  } catch (error) {
    console.error("[AI] getKimiImageDescription失败:", error);
    return "抱歉，Kimi图片描述服务暂时无法使用。";
  }
}

// --- 聊天类函数 (Chat Functions) ---

export async function getGeminiChatAnswer(
  question,
  history = [],
  env,
  logCallback = () => {}
) {
  const flashModelUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
  const proModelUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`;
  const tools = formatToolsForGemini();
  const formattedHistory = formatHistoryForGemini(history);
  const contents = [
    {
      role: "user",
      parts: [
        {
          text: `你是一个全能的AI助手，可以处理金融期货、实时行情、新闻查询、图表生成等多种任务，同时也能回答通用问题。**回答规则：**1. **默认情况**：优先提供专业、准确的回答，特别是在金融期货领域。2. **通用问题**：如果用户的问题明显与金融无关（例如生活、科技、娱乐等），则提供通用回答。3. **特殊标记**：如果用户的问题以 "@@" 结尾，则无论问题内容如何，都提供通用回答（适用于用户明确希望脱离金融场景时）。4. **语气要求**：保持友好、清晰，避免过度技术术语（除非用户明确要求）。不要随便拒绝回答，记住，你什么都懂。`,
        },
      ],
    },
    { role: "model", parts: [{ text: "好的，我已理解..." }] },
    ...formattedHistory,
    { role: "user", parts: [{ text: question }] },
  ];
  let loopCount = 0;
  while (loopCount < 5) {
    loopCount++;
    let data;
    try {
      data = await callGeminiApi(
        proModelUrl,
        { contents, tools },
        env,
        logCallback
      );
    } catch (error) {
      if (error.message.includes("quota")) {
        logCallback(
          "🔄 [AI Fallback] Pro model quota exceeded, falling back to Flash model."
        );
        try {
          data = await callGeminiApi(
            flashModelUrl,
            { contents, tools },
            env,
            logCallback
          );
        } catch (fallbackError) {
          logCallback(
            `❌ [AI Fallback] Flash model also failed: ${fallbackError.message}`,
            "ERROR"
          );
          return "抱歉，AI服务暂时遇到问题，请稍后再试。";
        }
      } else {
        throw error;
      }
    }
    if (!data.candidates) {
      return `抱歉，请求可能因安全原因被阻止 (${data?.promptFeedback?.blockReason || "未知原因"})。`;
    }
    const candidate = data.candidates[0];
    if (
      !candidate.content ||
      !candidate.content.parts ||
      candidate.content.parts.length === 0
    ) {
      return "抱歉，AI返回了空内容。";
    }
    const functionCallParts = candidate.content.parts.filter(
      (p) => p.functionCall
    );
    if (functionCallParts.length > 0) {
      contents.push(candidate.content);
      const toolResponseParts = await Promise.all(
        functionCallParts.map(async (part) => {
          const { name, args } = part.functionCall;
          logCallback(
            `🛠️ [Tool Call] Gemini is calling function: ${name}`,
            "INFO",
            args
          );
          const tool = availableTools[name];
          if (tool) {
            try {
              const result = await tool(args, env);
              logCallback(
                `✅ [Tool Result] Function ${name} returned successfully.`
              );
              return {
                functionResponse: { name, response: { content: result } },
              };
            } catch (e) {
              logCallback(
                `❌ [Tool Error] Function ${name} failed: ${e.message}`,
                "ERROR",
                e
              );
              return {
                functionResponse: {
                  name,
                  response: { content: `工具执行失败: ${e.message}` },
                },
              };
            }
          } else {
            logCallback(
              `❓ [Tool Error] Function ${name} is not available.`,
              "WARN"
            );
            return {
              functionResponse: {
                name,
                response: { content: `函数 '${name}' 不可用。` },
              },
            };
          }
        })
      );
      contents.push({ role: "tool", parts: toolResponseParts });
    } else if (candidate.content.parts[0]?.text) {
      return candidate.content.parts[0].text;
    } else {
      return "抱歉，收到了无法解析的AI回复。";
    }
  }
  throw new Error("AI在多次工具调用后未提供最终答案。");
}

export async function getKimiChatAnswer(
  question,
  history = [],
  env,
  logCallback = () => {}
) {
  const tools = formatToolsForOpenAI();
  const formattedHistory = formatHistoryForOpenAI(history);
  const messages = [
    {
      role: "system",
      content: `你是一个全能的AI助手，可以处理金融期货、实时行情、新闻查询、图表生成等多种任务，同时也能回答通用问题。**回答规则：**1. **默认情况**：优先提供专业、准确的回答，特别是在金融期货领域。2. **通用问题**：如果用户的问题明显与金融无关（例如生活、科技、娱乐等），则提供通用回答。3. **特殊标记**：如果用户的问题以 "@@" 结尾，则无论问题内容如何，都提供通用回答（适用于用户明确希望脱离金融场景时）。4. **语气要求**：保持友好、清晰，避免过度技术术语（除非用户明确要求）。不要随便拒绝回答，记住，你什么都懂。`,
    },
    ...formattedHistory,
    { role: "user", content: question },
  ];
  try {
    const data = await callKimiApi(
      "moonshot-v1-8k",
      { messages, temperature: 0.3, tools, tool_choice: "auto" },
      env,
      logCallback
    );
    const choice = data.choices[0];
    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      const toolResults = await Promise.all(
        choice.message.tool_calls.map(async (toolCall) => {
          const { name, arguments: argsString } = toolCall.function;
          let args;
          try {
            args = JSON.parse(argsString);
          } catch (e) {
            logCallback(
              `❌ [Tool Error] Kimi function '${name}' argument parsing failed: ${e.message}`,
              "ERROR",
              { argsString }
            );
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              content: JSON.stringify({
                error: `工具参数解析失败: ${e.message}`,
              }),
            };
          }
          logCallback(
            `🛠️ [Tool Call] Kimi is calling function: ${name}`,
            "INFO",
            args
          );
          const tool = availableTools[name];
          try {
            if (!tool) throw new Error(`未知工具: ${name}`);
            const result = await tool(args, env);
            logCallback(
              `✅ [Tool Result] Kimi function ${name} returned successfully.`
            );
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              content: JSON.stringify({ content: result }),
            };
          } catch (e) {
            logCallback(
              `❌ [Tool Error] Kimi function ${name} failed: ${e.message}`,
              "ERROR",
              e
            );
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              content: JSON.stringify({ error: `工具执行失败: ${e.message}` }),
            };
          }
        })
      );
      const finalMessages = [...messages, choice.message, ...toolResults];
      const finalData = await callKimiApi(
        "moonshot-v1-8k",
        { messages: finalMessages, temperature: 0.3 },
        env,
        logCallback
      );
      return finalData.choices[0].message.content;
    } else {
      return choice.message.content;
    }
  } catch (error) {
    console.error("[AI] getKimiChatAnswer失败:", error);
    return "抱歉，Kimi聊天服务暂时遇到问题，请稍后再试。";
  }
}

export async function getDeepSeekChatAnswer(
  question,
  history = [],
  env,
  logCallback = () => {}
) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("服务器配置错误：未设置DEEPSEEK_API_KEY。");
  const now = new Date();
  const beijingTimeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
  const [beijingHourStr, beijingMinuteStr] = beijingTimeFormatter
    .format(now)
    .split(":");
  const beijingHour = parseInt(beijingHourStr, 10);
  const beijingMinute = parseInt(beijingMinuteStr, 10);
  let modelToUse =
    (beijingHour === 0 && beijingMinute >= 31) ||
    (beijingHour > 0 && beijingHour < 8) ||
    (beijingHour === 8 && beijingMinute <= 29)
      ? "deepseek-coder"
      : "deepseek-chat";
  const tools = formatToolsForOpenAI();
  const formattedHistory = formatHistoryForOpenAI(history);
  const messages = [
    {
      role: "system",
      content:
        "你是一个有用的助手，善于用简洁的markdown语言来回答用户问题，并能够使用工具获取实时数据。",
    },
    ...formattedHistory,
    { role: "user", content: question },
  ];
  try {
    logCallback(
      `🚀 [API Request] Calling DeepSeek API: POST https://api.deepseek.com/chat/completions`
    );
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelToUse,
        messages,
        temperature: 0.3,
        tools,
        tool_choice: "auto",
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      logCallback(
        `❌ [API Error] DeepSeek API error: ${response.status} ${errorText}`,
        "ERROR"
      );
      throw new Error(`DeepSeek API错误: ${response.status} ${errorText}`);
    }
    const data = await response.json();
    const choice = data.choices[0];
    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      const toolResults = await Promise.all(
        choice.message.tool_calls.map(async (toolCall) => {
          const { name, arguments: argsString } = toolCall.function;
          let args;
          try {
            args = JSON.parse(argsString);
          } catch (e) {
            logCallback(
              `❌ [Tool Error] DeepSeek function '${name}' argument parsing failed: ${e.message}`,
              "ERROR",
              { argsString }
            );
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              content: JSON.stringify({
                error: `工具参数解析失败: ${e.message}`,
              }),
            };
          }
          logCallback(
            `🛠️ [Tool Call] DeepSeek is calling function: ${name}`,
            "INFO",
            args
          );
          const tool = availableTools[name];
          try {
            if (!tool) throw new Error(`未知工具: ${name}`);
            const result = await tool(args, env);
            logCallback(
              `✅ [Tool Result] DeepSeek function ${name} returned successfully.`
            );
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              content: JSON.stringify({ content: result }),
            };
          } catch (e) {
            logCallback(
              `❌ [Tool Error] DeepSeek function ${name} failed: ${e.message}`,
              "ERROR",
              e
            );
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              content: JSON.stringify({ error: `工具执行失败: ${e.message}` }),
            };
          }
        })
      );
      const finalMessages = [...messages, choice.message, ...toolResults];
      const finalResponse = await fetch(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelToUse,
            messages: finalMessages,
            temperature: 0.3,
          }),
        }
      );
      if (!finalResponse.ok) {
        const errorText = await finalResponse.text();
        throw new Error(
          `DeepSeek API错误: ${finalResponse.status} ${errorText}`
        );
      }
      const finalResult = await finalResponse.json();
      return finalResult.choices[0].message.content;
    } else {
      return choice.message.content;
    }
  } catch (error) {
    console.error("[AI] getDeepSeekChatAnswer失败:", error);
    return "抱歉，DeepSeek聊天服务暂时遇到问题，请稍后再试。";
  }
}
