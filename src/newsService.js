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

    const mappedData = data.data.map((item) => ({
      title: item.title || '无标题',
      url: item.url || '#',
      hot_value: item.hot_value || '0',
    }));
    console.log(`[NewsService] Successfully processed ${mappedData.length} TongHuaShun news items.`);
    return mappedData;
  } catch (error) {
    console.error('[NewsService] 获取同花顺新闻数据失败:', error.message);
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

    const mappedData = data.data.entity.map((item) => ({
      title: item.artTitle || '无标题',
      url: `https://q.889.ink/qhweb_news/${item.artCode || '0'}.html`,
      hot_value: (item.readNum || '0').toString(),
    }));
    console.log(`[NewsService] Successfully processed ${mappedData.length} DongFangCaiFu news items.`);
    return mappedData;
  } catch (error) {
    console.error('[NewsService] 获取东方财富新闻数据失败:', error.message);
    throw new Error(`获取东方财富新闻失败: ${error.message}`);
  }
}

/**
 * 根据关键词获取相关新闻。
 * @param {string} keyword - 要搜索新闻的关键词。
 * @returns {Promise<string>} - 包含新闻列表的JSON字符串。
 */
export async function getNews(keyword) {
  try {
    console.log(`[getNews] Searching news for keyword: ${keyword}`);
    const [thsNews, emNews] = await Promise.all([
      fetchNewsFromTongHuaShun().catch(e => { console.error(e); return []; }),
      fetchNewsFromDongFangCaiFu().catch(e => { console.error(e); return []; })
    ]);

    const allNews = [...thsNews, ...emNews];
    
    const lowerKeyword = keyword.toLowerCase();
    const filteredNews = allNews
      .filter(item => item.title.toLowerCase().includes(lowerKeyword))
      .slice(0, 5); // 返回最多5条相关新闻

    if (filteredNews.length > 0) {
      console.log(`[getNews] Found ${filteredNews.length} news items for keyword "${keyword}".`);
      return JSON.stringify(filteredNews);
    } else {
      // 如果没有找到，返回一个通用的热门新闻作为备选
      const fallbackNews = allNews.slice(0, 3);
      console.log(`[getNews] No news found for "${keyword}". Returning ${fallbackNews.length} top news items as fallback.`);
      return JSON.stringify({
        message: `No news found for "${keyword}". Here are some top news instead.`,
        news: fallbackNews
      });
    }
  } catch (error) {
    console.error(`[getNews] Failed to get news for ${keyword}:`, error);
    return JSON.stringify({ error: `Failed to fetch news for ${keyword}.` });
  }
}
