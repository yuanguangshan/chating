// src/services/futuresDataService.js

// 名称到代码的映射表
const nameToSymbolMap = {
    "螺纹钢": "rb",
    "黄金": "au",
    "原油": "sc",
    "白银": "ag",
    "铜": "cu",
    "铝": "al",
    "锌": "zn",
    "铅": "pb",
    "镍": "ni",
    "锡": "sn",
    "铁矿石": "i",
    "焦炭": "j",
    "焦煤": "jm",
    "动力煤": "ZC",
    "甲醇": "MA",
    "乙二醇": "eg",
    "聚丙烯": "pp",
    "塑料": "l",
    "PVC": "v",
    "苯乙烯": "eb",
    "纯碱": "SA",
    "尿素": "UR",
    "PTA": "TA",
    "短纤": "PF",
    "橡胶": "ru",
    "20号胶": "nr",
    "纸浆": "sp",
    "沥青": "bu",
    "���料油": "fu",
    "低硫燃料油": "lu",
    "LPG": "pg",
    "豆一": "a",
    "豆二": "b",
    "豆粕": "m",
    "豆油": "y",
    "棕榈油": "p",
    "菜籽油": "OI",
    "菜粕": "RM",
    "玉米": "c",
    "玉米淀粉": "cs",
    "棉花": "CF",
    "棉纱": "CY",
    "白糖": "SR",
    "苹果": "AP",
    "红枣": "CJ",
    "鸡蛋": "jd",
    "生猪": "LH",
    "玻璃": "FG",
    "硅铁": "SF",
    "锰硅": "SM",
    "花生": "PK",
    "碳酸锂": "lc",
    "工业硅": "si",
    "集运指数": "ec",
};


const fetchData = async (url) => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      console.error(`[期货数据] 对 ${url} 的API请求失败，状态码 ${response.status}`);
      throw new Error(`API请求失败，状态码 ${response.status}`);
    }
    console.log(`[期货数据] 成功从 ${url} 获取数据`);
    return response.json();
  } catch (error) {
    console.error(`[期货数据] 从 ${url} 获取数据时出错:`, error);
    throw error;
  }
}

const calculateYield = (zdf, marginRatio) => {
  if (!marginRatio) return null
  return (zdf / marginRatio).toFixed(2)
}

const getFuturesData = async () => {
  try {
    const [zdfResponse, marginResponse] = await Promise.all([
      fetchData('https://q.889.ink/'),
      fetchData('https://q.889.ink/margin/')
    ])

    const zdfData = zdfResponse.list
    const marginDataMap = new Map(marginResponse.data.map((item) => [item.uniqueIdEx, item]))

    const processedData = zdfData
      .map((zdfItem) => {
        const marginItem = marginDataMap.get(zdfItem.dm)

        if (!marginItem) {
          console.warn(`未找到代码 ${zdfItem.dm} 匹配的保证金数据`)
          return null
        }

        const { dm, name, zdf5, zdf20, zdfly, zdf250, zjlx, cdzj, ccl, vol, cje, zdf, tjd } =
          zdfItem

        const { marginRatio, transMargin } = marginItem

        return {
          name,
          dm,
          marginRatio,
          transMargin,
          zdf5,
          zdf20,
          zdfly,
          yield5: calculateYield(zdf5, marginRatio),
          yield20: calculateYield(zdf20, marginRatio),
          yieldly: calculateYield(zdfly, marginRatio),
          zdf250,
          zjlx:zjlx,//convertToYuanYi(zjlx), // 转换为亿元
          cdzj: cdzj,//convertToYuanYi(cdzj), // 转换为亿元
          ccl: ccl,//convertToWanShou(ccl), // 转换为万手
          vol: vol,//convertToWanShou(vol), // 转换为万手
          cje: cje,//convertToYuanYi(cje), // 转换为亿元
          zdf,
          tjd
        }
      })
      .filter(Boolean)
    console.log(`[期货数据] 成功获取并处理了 ${processedData.length} 条期货数据。`);
    return processedData;
  } catch (error) {
    console.error('[期货数据] 获取期货数据失败:', error);
    throw error;
  }
}

/**
 * 获取单个期货合约的最新价格信息。
 * @param {string} name - 期货品种的中文名称 (e.g., '螺纹钢', '黄金').
 * @returns {Promise<string>} - 包含价格信息的JSON字符串，如果找不到则返回错误信息。
 */
const getPrice = async (name) => {
  try {
    console.log(`[获取价格] 收到名称: "${name}"`);
    if (!name) {
        console.warn(`[获取价格] 缺少名称参数。`);
        return JSON.stringify({ error: "缺少名称参数。" });
    }

    // 从映射中查找代码，如果找不到，则直接使用输入（以支持直接输入代码）
    const symbol = nameToSymbolMap[name] || name;
    console.log(`[获取价格] 将名称 "${name}" 映射到代码: "${symbol}"`);

    const response = await fetchData('https://q.889.ink/');
    const allData = response.list;
    
    const lowerSymbol = symbol.toLowerCase();

    const contract = allData.find(item => {
        if (!item || !item.dm || !item.name) return false;
        
        // 匹配逻辑 1: 合约代码前缀 (e.g., "rb" matches "RB2410")
        const itemPrefix = item.dm.replace(/[0-9]/g, '').toLowerCase();
        if (itemPrefix === lowerSymbol) return true;

        // 匹配逻辑 2: 中文名 (e.g., "螺纹钢" matches "螺纹钢2410")
        const simplifiedName = getSimplifiedName(item.name).toLowerCase();
        if (simplifiedName === lowerSymbol) return true;
        
        return false;
    });

    if (contract) {
      console.log(`[获取价格] 找到合约:`, contract);
      // 提取关键价格信息
      const priceInfo = {
        symbol: contract.dm,
        name: contract.name,
        price: contract.p, // 最新价
        open: contract.o,
        high: contract.h,
        low: contract.l,
        prev_close: contract.qrspj,
        change_percent: contract.zdf, // 涨幅
        change_value: contract.zde,
        volume: contract.vol, // 成交量
        amount: contract.cje, // 成交额
        zdf5: contract.zdf5, // 5日涨幅
        zdf20: contract.zdf20, // 20日涨幅
        zdfly: contract.zdfly, // 年初至今涨幅
        zdf250: contract.zdf250, // 250日涨幅
        timestamp: contract.utime
      };
      console.log(`[获取价格] 找到合约 "${name}" (代码 "${symbol}"):`, priceInfo);
      return JSON.stringify(priceInfo);
    } else {
      console.warn(`[获取价格] 未找到名为 '${name}' (代码 '${symbol}') 的合约。`);
      return JSON.stringify({ error: `未找到名为 '${name}' (代码 '${symbol}') 的合约。` });
    }
  } catch (error) {
    console.error(`[获取价格] 获取 ${name} 的价格失败:`, error);
    return JSON.stringify({ error: `获取 ${name} 的价格数据失败。` });
  }
};

// 辅助函数，用于从合约名称中提取代码 (���如 "螺纹钢2410" -> "螺纹钢")
// 这个函数应该与 chart_generator.js 中的保持一致
function getSimplifiedName(fullName) {
    const match = fullName.match(/^([^\d]+)/);
    return match && match[1] ? match[1] : fullName;
}


export {
  getFuturesData,
  getPrice
}
