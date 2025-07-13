// src/services/futuresDataService.js

const fetchData = async (url) => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    return response.json();
  } catch (error) {
    console.error(`Error fetching data from ${url}:`, error);
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

    return zdfData
      .map((zdfItem) => {
        const marginItem = marginDataMap.get(zdfItem.dm)

        if (!marginItem) {
          console.warn(`No matching margin data for dm ${zdfItem.dm}`)
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
  } catch (error) {
    console.error('Failed to fetch futures data:', error)
    throw error
  }
}

/**
 * 获取单个期货合约的最新价格信息。
 * @param {string} symbol - 期货合约代码 (e.g., 'rb', 'au').
 * @returns {Promise<string>} - 包含价格信息的JSON字符串，如果找不到则返回错误信息。
 */
const getPrice = async (symbol) => {
  try {
    console.log(`[getPrice] Searching for symbol: "${symbol}"`);
    const response = await fetchData('https://q.889.ink/');
    const allData = response.list;
    
    if (!symbol) {
        return JSON.stringify({ error: "Symbol parameter is missing." });
    }
    
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
      console.log(`[getPrice] Found contract:`, contract);
      // 提取关键价格信息
      const priceInfo = {
        symbol: contract.dm,
        name: contract.name,
        price: contract.p, // 最新价
        open: contract.o,
        high: contract.h,
        low: contract.l, // <-- Bug fix: was 'l' string
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
      return JSON.stringify(priceInfo);
    } else {
      return JSON.stringify({ error: `Contract with symbol '${symbol}' not found.` });
    }
  } catch (error) {
    console.error(`Failed to get price for ${symbol}:`, error);
    return JSON.stringify({ error: `Failed to fetch price data for ${symbol}.` });
  }
};

// 辅助函数，用于从合约名称中提取代码 (例如 "螺纹钢2410" -> "螺纹钢")
// 这个函数应该与 chart_generator.js 中的保持一致
function getSimplifiedName(fullName) {
    const match = fullName.match(/^([^\d]+)/);
    return match && match[1] ? match[1] : fullName;
}


export {
  getFuturesData,
  getPrice
}
