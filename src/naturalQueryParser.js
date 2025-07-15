/**
 * 自然语言期货查询解析器
 * 将自然语言问题转换为API调用
 */

// 品种代码映射表
const SYMBOL_MAP = {
    '螺纹钢': 'rb',
    '螺纹': 'rb',
    'rb': 'rb',
    '热卷': 'hc',
    'hc': 'hc',
    '铜': 'cu',
    'cu': 'cu',
    '铝': 'al',
    'al': 'al',
    '锌': 'zn',
    'zn': 'zn',
    '铅': 'pb',
    'pb': 'pb',
    '镍': 'ni',
    'ni': 'ni',
    '锡': 'sn',
    'sn': 'sn',
    '黄金': 'au',
    'au': 'au',
    '白银': 'ag',
    'ag': 'ag',
    '原油': 'sc',
    'sc': 'sc',
    '燃油': 'fu',
    'fu': 'fu',
    '沥青': 'bu',
    'bu': 'bu',
    '橡胶': 'ru',
    'ru': 'ru',
    '豆粕': 'm',
    'm': 'm',
    '豆油': 'y',
    'y': 'y',
    '棕榈油': 'p',
    'p': 'p',
    '玉米': 'c',
    'c': 'c',
    '棉花': 'cf',
    'cf': 'cf',
    '白糖': 'sr',
    'sr': 'sr',
    'PTA': 'pta',
    'pta': 'pta',
    '甲醇': 'ma',
    'ma': 'ma',
    '尿素': 'ur',
    'ur': 'ur',
    '纯碱': 'sa',
    'sa': 'sa',
    '玻璃': 'fg',
    'fg': 'fg',
    '不锈钢': 'ss',
    'ss': 'ss',
    '铁矿石': 'i',
    'i': 'i',
    '焦炭': 'j',
    'j': 'j',
    '焦煤': 'jm',
    'jm': 'jm',
    '动力煤': 'zc',
    'zc': 'zc'
};

// 聚合函数映射
const AGG_FUNC_MAP = {
    '最高': 'MAX',
    '最高价': 'MAX',
    'max': 'MAX',
    '最低': 'MIN',
    '最低价': 'MIN',
    'min': 'MIN',
    '平均': 'AVG',
    '平均值': 'AVG',
    'avg': 'AVG',
    '总和': 'SUM',
    'sum': 'SUM',
    '总量': 'SUM'
};

// 字段映射
const COLUMN_MAP = {
    '开盘价': '开盘',
    '开盘': '开盘',
    '收盘价': '收盘',
    '收盘': '收盘',
    '最高价': '最高',
    '最高': '最高',
    '最低价': '最低',
    '最低': '最低',
    '成交量': '成交量',
    '成交': '成交量',
    '成交额': '成交额',
    '金额': '成交额',
    '持仓量': '持仓',
    '持仓': '持仓'
};

/**
 * 解析自然语言查询
 * @param {string} query - 自然语言查询
 * @returns {Object} 解析后的参数
 */
export function parseNaturalQuery(query) {
    const normalized = query.toLowerCase();
    
    // 初始化结果
    const result = {
        type: null,
        symbol: null,
        days: null,
        aggFunc: null,
        column: null,
        limit: 100,
        originalQuery: query
    };
    
    // 提取品种代码
    const symbolMatch = extractSymbol(normalized);
    if (symbolMatch) {
        result.symbol = symbolMatch.code;
    }
    
    // 检查查询类型
    if (normalized.includes('最高') || normalized.includes('最低') || 
        normalized.includes('平均') || normalized.includes('总和')) {
        result.type = 'aggregate';
        
        // 提取天数
        result.days = extractDays(normalized);
        
        // 提取聚合函数
        result.aggFunc = extractAggFunc(normalized);
        
        // 提取字段
        result.column = extractColumn(normalized);
        
    } else if (normalized.includes('日线') || normalized.includes('日k') || 
               normalized.includes('日k线')) {
        result.type = 'daily';
        result.limit = extractLimit(normalized) || 100;
        
    } else if (normalized.includes('分钟') || normalized.includes('分钟线') || 
               normalized.includes('分时')) {
        result.type = 'minute';
        result.days = extractDays(normalized) || 1;
        
    } else if (normalized.includes('龙虎榜') || normalized.includes('持仓')) {
        result.type = 'lhb';
        result.limit = extractLimit(normalized) || 100;
        
    } else {
        // 默认查询最新日线
        result.type = 'daily';
        result.limit = extractLimit(normalized) || 10;
    }
    
    return result;
}

/**
 * 提取品种代码
 */
function extractSymbol(text) {
    // 直接匹配代码
    const codeRegex = /\b([a-zA-Z]{1,3})\d*\b/g;
    const codeMatch = text.match(codeRegex);
    if (codeMatch) {
        const code = codeMatch[0].toLowerCase().replace(/\d+$/, '');
        if (Object.values(SYMBOL_MAP).includes(code)) {
            return { code, name: Object.keys(SYMBOL_MAP).find(k => SYMBOL_MAP[k] === code) };
        }
    }
    
    // 匹配中文名称
    for (const [name, code] of Object.entries(SYMBOL_MAP)) {
        if (text.includes(name.toLowerCase())) {
            return { code, name };
        }
    }
    
    return null;
}

/**
 * 提取天数
 */
function extractDays(text) {
    const daysRegex = /(\d+)\s*(天|日|天|天)/g;
    const match = text.match(daysRegex);
    if (match) {
        const days = parseInt(match[0].match(/\d+/)[0]);
        return Math.min(days, 365); // 限制最大天数
    }
    return 5; // 默认5天
}

/**
 * 提取聚合函数
 */
function extractAggFunc(text) {
    for (const [keyword, func] of Object.entries(AGG_FUNC_MAP)) {
        if (text.includes(keyword.toLowerCase())) {
            return func;
        }
    }
    return 'MAX'; // 默认最高
}

/**
 * 提取字段
 */
function extractColumn(text) {
    for (const [keyword, column] of Object.entries(COLUMN_MAP)) {
        if (text.includes(keyword.toLowerCase())) {
            return column;
        }
    }
    return '最高'; // 默认最高价
}

/**
 * 提取限制条数
 */
function extractLimit(text) {
    const limitRegex = /(\d+)\s*(条|个|笔)/g;
    const match = text.match(limitRegex);
    if (match) {
        const limit = parseInt(match[0].match(/\d+/)[0]);
        return Math.min(limit, 1000); // 限制最大条数
    }
    return null;
}

/**
 * 生成自然语言的查询描述
 */
export function generateQueryDescription(parsed) {
    const descriptions = {
        aggregate: `查询${parsed.symbol}品种过去${parsed.days}天的${parsed.aggFunc}${parsed.column}`,
        daily: `查询${parsed.symbol}品种最新${parsed.limit}条日线数据`,
        minute: `查询${parsed.symbol}品种最近${parsed.days}天的分钟线数据`,
        lhb: `查询${parsed.symbol}品种龙虎榜数据`
    };
    
    return descriptions[parsed.type] || `查询${parsed.symbol}品种数据`;
}

/**
 * 验证查询参数
 */
export function validateQuery(parsed) {
    const errors = [];
    
    if (!parsed.symbol) {
        errors.push('无法识别期货品种，请提供正确的品种名称或代码');
    }
    
    if (parsed.type === 'aggregate') {
        if (!parsed.days || parsed.days <= 0) {
            errors.push('天数必须是正整数');
        }
        if (parsed.days > 365) {
            errors.push('查询天数不能超过365天');
        }
    }
    
    return errors;
}