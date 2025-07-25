// src/futuresToolkit.js
const baseURL = "https://api.yuangs.cc"; // 也可在 env 里覆盖

// 内部通用调用
async function getFrom(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`行情接口 ${r.status}`);
  const { meta, data } = await r.json();
  return { meta, rows: data }; // 默认按远端顺序
}

// 1. 日线列表
export async function queryFuturesDaily(symbol, limit = 100) {
  return getFrom(`${baseURL}/api/futures?code=${symbol}&limit=${limit}`);
}

// 2. 分时线
export async function queryMinutelyHistory(symbol, days = 1) {
  return getFrom(`${baseURL}/api/minute?code=${symbol}&limit=${days * 270}`);
}

// 3. 期货行情
export async function queryOptionQuote(symbol, limit = 100) {
  return getFrom(`${baseURL}/api/qhhq?code=${symbol}&limit=${limit}`);
}

// 4. 龙虎榜
export async function queryLHB(symbol, limit = 100) {
  return getFrom(`${baseURL}/api/qhlhb?code=${symbol}&limit=${limit}`);
}

// 5. 聚合查询 - 基于你的新API
export async function queryAggregate(
  symbol,
  days = 5,
  aggFunc = "MAX",
  column = "最高"
) {
  return getFrom(
    `${baseURL}/api/aggregate?code=${symbol}&days=${days}&agg_func=${aggFunc}&agg_col=${column}`
  );
}

// 6. 智能查询助手 - 封装常用查询场景
export async function smartQuery(query) {
  // 直接调用后端智能解析
  const url = `${baseURL}/api/smart?query=${encodeURIComponent(query)}`;
  return getFrom(url);
}

// 7. 快捷查询函数
export async function getHighestPrice(symbol, days = 5) {
  return queryAggregate(symbol, days, "MAX", "最高");
}

export async function getLowestPrice(symbol, days = 5) {
  return queryAggregate(symbol, days, "MIN", "最低");
}

export async function getAverageVolume(symbol, days = 5) {
  return queryAggregate(symbol, days, "AVG", "成交量");
}

export async function getLatestData(symbol, limit = 10) {
  return queryFuturesDaily(symbol, limit);
}
