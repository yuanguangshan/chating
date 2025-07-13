export async function fetchNewsFromTongHuaShun() {
  try {
    console.log('开始请求同花顺新闻数据...');
    const response = await fetch('https://q.889.ink/thsNews', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`同花顺API请求失败，状态码: ${response.status}`);
    }

    const data = await response.json();
    console.log('同花顺API响应:', data);
    if (!data) {
      throw new Error('同花顺API返回数据为空');
    }
    if (!data.data) {
      throw new Error('同花顺API返回数据结构异常: 缺少data字段');
    }
    if (!Array.isArray(data.data)) {
      throw new Error('同花顺API返回数据结构异常: data字段不是数组');
    }

    return data.data.map((item) => ({
      title: item.title || '无标题',
      url: item.url || '#',
      hot_value: item.hot_value || '0',
    }));
  } catch (error) {
    console.error('获取同花顺新闻数据失败:', error.message);
    throw new Error(`获取同花顺新闻失败: ${error.message}`);
  }
}

export async function fetchNewsFromDongFangCaiFu() {
  try {
    console.log('开始请求东方财富新闻数据...');
    const response = await fetch('https://q.889.ink/em_hotNews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`东方财富API请求失败，状态码: ${response.status}`);
    }

    const data = await response.json();
    console.log('东方财富API响应:', data);
    if (!data) {
      throw new Error('东方财富API返回数据为空');
    }
    if (!data.data) {
      throw new Error('东方财富API返回数据结构异常: 缺少data字段');
    }
    if (!Array.isArray(data.data.entity)) {
      throw new Error('东方财富API返回数据结构异常: entity字段不是数组');
    }

    return data.data.entity.map((item) => ({
      title: item.artTitle || '无标题',
      url: `https://q.889.ink/qhweb_news/${item.artCode || '0'}.html`,
      hot_value: (item.readNum || '0').toString(),
    }));
  } catch (error) {
    console.error('获取东方财富新闻数据失败:', error.message);
    throw new Error(`获取东方财富新闻失败: ${error.message}`);
  }
}
