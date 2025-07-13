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

export {
  getFuturesData
}
