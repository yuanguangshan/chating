/**
 * 数据API服务封装
 * 封装对后端API的调用
 */

const API_BASE_URL = "https://api.yuangs.cc";

/**
 * 通用API调用函数
 */
async function callApi(endpoint, params = {}) {
  try {
    const url = new URL(`${API_BASE_URL}${endpoint}`);
    Object.keys(params).forEach((key) => {
      if (params[key] !== null && params[key] !== undefined) {
        url.searchParams.append(key, params[key]);
      }
    });

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`API调用失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`API调用错误: ${error.message}`);
    throw error;
  }
}

/**
 * 获取期货日线数据
 */
export async function getFuturesDaily(symbol, limit = 100) {
  const data = await callApi("/api/futures", {
    code: symbol,
    limit: limit,
  });
  return data;
}

/**
 * 获取分钟线数据
 */
export async function getMinuteData(symbol, limit = 100) {
  const data = await callApi("/api/minute", {
    code: symbol,
    limit: limit,
  });
  return data;
}

/**
 * 获取龙虎榜数据
 */
export async function getLHBData(symbol, limit = 100) {
  const data = await callApi("/api/qhlhb", {
    code: symbol,
    limit: limit,
  });
  return data;
}

/**
 * 获取期货行情数据
 */
export async function getQHHQData(symbol, limit = 100) {
  const data = await callApi("/api/qhhq", {
    code: symbol,
    limit: limit,
  });
  return data;
}

/**
 * 聚合查询函数
 */
export async function getAggregateData(symbol, days, aggFunc, column) {
  const data = await callApi("/api/aggregate", {
    code: symbol,
    days: days,
    agg_func: aggFunc,
    agg_col: column,
  });
  return data;
}

/**
 * 格式化聚合结果
 */
export function formatAggregateResult(data, symbol, days, aggFunc, column) {
  if (
    !data ||
    !data.data ||
    data.data.result === null ||
    data.data.result === undefined
  ) {
    return `未找到${symbol}过去${days}天的${column}${
      aggFunc === "MAX"
        ? "最高"
        : aggFunc === "MIN"
          ? "最低"
          : aggFunc === "AVG"
            ? "平均"
            : ""
    }值`;
  }

  const value = data.data.result;
  const unit =
    column === "成交量" ? "手" : column === "成交额" ? "元" : "元/吨";

  return `${symbol}品种过去${days}天的${column}${
    aggFunc === "MAX"
      ? "最高"
      : aggFunc === "MIN"
        ? "最低"
        : aggFunc === "AVG"
          ? "平均"
          : ""
  }值为 ${value}${unit}`;
}

/**
 * 格式化日线数据摘要
 */
export function formatDailySummary(data, symbol) {
  if (!data || !data.data || data.data.length === 0) {
    return `未找到${symbol}的日线数据`;
  }

  const latest = data.data[0];
  return `${symbol}最新行情：
- 日期：${latest["日期"]}
- 开盘：${latest["开盘"]}元/吨
- 收盘：${latest["收盘"]}元/吨
- 最高：${latest["最高"]}元/吨
- 最低：${latest["最低"]}元/吨
- 成交量：${latest["成交量"]}手`;
}

/**
 * 智能查询接口（集成自然语言解析）
 */
export async function smartQuery(query) {
  const { parseNaturalQuery, validateQuery, generateQueryDescription } =
    await import("./naturalQueryParser.js");

  try {
    const parsed = parseNaturalQuery(query);
    const errors = validateQuery(parsed);

    if (errors.length > 0) {
      return {
        success: false,
        error: errors.join("，"),
        suggestion: "请提供正确的品种名称，如：螺纹钢(rb)、铜(cu)、黄金(au)等",
      };
    }

    let result;
    let formattedResult;

    switch (parsed.type) {
      case "aggregate":
        result = await getAggregateData(
          parsed.symbol,
          parsed.days,
          parsed.aggFunc,
          parsed.column
        );
        formattedResult = formatAggregateResult(
          result,
          parsed.symbol,
          parsed.days,
          parsed.aggFunc,
          parsed.column
        );
        break;

      case "daily":
        result = await getFuturesDaily(parsed.symbol, parsed.limit);
        formattedResult = formatDailySummary(result, parsed.symbol);
        break;

      case "minute":
        result = await getMinuteData(parsed.symbol, parsed.limit);
        formattedResult = `${parsed.symbol}品种最近${parsed.days}天的分钟线数据已获取，共${result.data?.length || 0}条记录`;
        break;

      case "lhb":
        result = await getLHBData(parsed.symbol, parsed.limit);
        formattedResult = `${parsed.symbol}品种龙虎榜数据已获取，共${result.data?.length || 0}条记录`;
        break;

      default:
        result = await getFuturesDaily(parsed.symbol, 10);
        formattedResult = formatDailySummary(result, parsed.symbol);
    }

    return {
      success: true,
      data: result,
      description: generateQueryDescription(parsed),
      formatted: formattedResult,
      query: parsed,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      suggestion: "请检查网络连接或稍后重试",
    };
  }
}

/**
 * 健康检查
 */
export async function healthCheck() {
  try {
    const data = await callApi("/health");
    return data.status === "healthy";
  } catch (error) {
    return false;
  }
}
