// src/futuresToolkit.js
const baseURL = 'https://api.yuangs.cc';   // 也可在 env 里覆盖

// 内部通用调用
async function getFrom(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`行情接口 ${r.status}`);
  const { meta, data } = await r.json();
  return { meta, rows: data };         // 默认按远端顺序
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