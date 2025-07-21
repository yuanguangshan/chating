/**
 * 新闻灵感服务
 * 获取来自不同社交媒体和技术社区的热点话题和内容，作为创作灵感。
 */

class NewsInspirationService {
    constructor(env = null) {
        // This URL is based on the provided image and assumes a proxy
        // that handles the 's?id=' format for different sources.
        this.apiBaseUrl = env?.YOUR_EXTERNAL_NEWS_API_BASE_URL || 'https://newsnow.want.biz/api/s?id='; 
        this.cache = {}; // Simple in-memory cache
        this.cacheDuration = 5 * 60 * 1000; // 5 minutes cache
        this.useMockData = true; // Enable mock data as fallback when API fails
    }

    #getMockData(sourceId) {
        const mockData = {
            hupu: {
                items: [
                    { id: 'h1', title: 'NBA季后赛激战正酣，湖人vs掘金抢七大战', url: 'https://bbs.hupu.com/1', hotValue: 50000 },
                    { id: 'h2', title: '国足世预赛最新动态：国足1-0小胜泰国', url: 'https://bbs.hupu.com/2', hotValue: 35000 },
                    { id: 'h3', title: 'CBA总决赛：辽宁vs广东巅峰对决', url: 'https://bbs.hupu.com/3', hotValue: 28000 }
                ]
            },
            weibo: {
                items: [
                    { id: 'w1', title: '#高考放榜# 各省高考分数线陆续公布', url: 'https://weibo.com/1', hotValue: 80000 },
                    { id: 'w2', title: '#夏日限定美食# 网红冰淇淋测评', url: 'https://weibo.com/2', hotValue: 42000 },
                    { id: 'w3', title: '#毕业季# 青春不散场', url: 'https://weibo.com/3', hotValue: 30000 }
                ]
            },
            douyin: {
                items: [
                    { id: 'd1', title: '爆火舞蹈挑战：科目三全网模仿', url: 'https://douyin.com/1', hotValue: 65000 },
                    { id: 'd2', title: '美食博主探店：隐藏版深夜食堂', url: 'https://douyin.com/2', hotValue: 38000 },
                    { id: 'd3', title: '萌宠视频：猫咪的搞笑日常', url: 'https://douyin.com/3', hotValue: 25000 }
                ]
            },
            hackernews: {
                items: [
                    { id: 'hn1', title: 'OpenAI发布GPT-4o最新版本', url: 'https://news.ycombinator.com/1', hotValue: 45000 },
                    { id: 'hn2', title: 'Linux内核6.9发布，性能大幅提升', url: 'https://news.ycombinator.com/2', hotValue: 32000 },
                    { id: 'hn3', title: 'React 19新特性详解', url: 'https://news.ycombinator.com/3', hotValue: 28000 }
                ]
            },
            nowcoder: {
                items: [
                    { id: 'nc1', title: '字节跳动2025校招启动，算法岗竞争激烈', url: 'https://nowcoder.com/1', hotValue: 40000 },
                    { id: 'nc2', title: 'LeetCode周赛：双周赛第108题解', url: 'https://nowcoder.com/2', hotValue: 22000 },
                    { id: 'nc3', title: '面试经验：腾讯后端开发面经', url: 'https://nowcoder.com/3', hotValue: 18000 }
                ]
            }
        };
        return mockData[sourceId] || { items: [] };
    }

    async #fetchData(sourceId) {
        const url = `${this.apiBaseUrl}${sourceId}`;
        const now = Date.now();

        // Check cache first
        if (this.cache[sourceId] && now - this.cache[sourceId].timestamp < this.cacheDuration) {
            console.log(`[NewsInspirationService] Fetching ${sourceId} from cache.`);
            return this.cache[sourceId].data;
        }

        try {
            console.log(`[NewsInspirationService] Fetching ${sourceId} from ${url}`);
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`API request to ${sourceId} failed: ${response.status} ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(`Invalid content type: ${contentType}. Expected application/json`);
            }

            const data = await response.json();
            
            // Validate response structure
            if (!data || !Array.isArray(data.items)) {
                console.warn(`[NewsInspirationService] Invalid response structure for ${sourceId}:`, data);
                return this.useMockData ? this.#getMockData(sourceId) : { items: [] };
            }
            
            // Update cache
            this.cache[sourceId] = {
                timestamp: now,
                data: data
            };

            return data;
        } catch (error) {
            console.error(`[NewsInspirationService] Failed to fetch ${sourceId}: ${error.message}`);
            
            // Use mock data as fallback when API fails
            if (this.useMockData) {
                console.log(`[NewsInspirationService] Using mock data for ${sourceId}`);
                return this.#getMockData(sourceId);
            }
            
            return { items: [] }; // Return empty items array instead of null to prevent null reference errors
        }
    }

    #normalizeHupu(rawData) {
        if (!rawData?.items) return [];
        return rawData.items.map(item => ({
            id: item.id,
            title: item.title,
            url: item.url || item.mobileUrl || '#',
            source: '虎扑',
            hotValue: 0, // Hupu sample doesn't have explicit hotness, set to 0 for sorting
            description: item.title, 
            time: new Date().toISOString(),
            type: 'general_news'
        }));
    }

    #normalizeDouyin(rawData) {
        if (!rawData?.items) return [];
        return rawData.items.map(item => ({
            id: item.id,
            title: item.title,
            url: item.url || '#',
            source: '抖音',
            hotValue: 0, // Douyin sample doesn't have explicit hotness
            description: item.title,
            time: new Date().toISOString(),
            type: 'general_news'
        }));
    }

    #normalizeWeibo(rawData) {
        if (!rawData?.items) return [];
        return rawData.items.map(item => ({
            id: item.id,
            title: item.title,
            url: item.url || item.mobileUrl || '#',
            source: '微博',
            hotValue: 0, // Weibo sample doesn't have explicit hotness
            description: item.title,
            time: new Date().toISOString(),
            type: 'general_news'
        }));
    }

    #normalizeHackerNews(rawData) {
        if (!rawData?.items) return [];
        return rawData.items.map(item => ({
            id: item.id,
            title: item.title,
            url: item.url || '#',
            source: 'HackerNews',
            hotValue: item.extra?.info ? parseInt(item.extra.info.replace(' points', '')) : 0, // Parse points as hotness
            description: item.title,
            time: new Date().toISOString(),
            type: 'tech_news'
        }));
    }

    #normalizeNowcoder(rawData) {
        if (!rawData?.items) return [];
        return rawData.items.map(item => ({
            id: item.id,
            title: item.title,
            url: item.url || '#',
            source: '牛客网',
            hotValue: 0, // Nowcoder sample doesn't have explicit hotness
            description: item.title,
            time: new Date().toISOString(),
            type: 'tech_news'
        }));
    }

    /**
     * 获取新闻灵感列表（兼容旧接口）
     * @returns {Promise<Array>} 包含标准化新闻对象的数组。
     */
    async getInspirations() {
        return this.getCombinedNewsInspiration();
    }

    /**
     * 获取并合并来自多个来源的新闻灵感。
     * @returns {Promise<Array>} 包含标准化新闻对象的数组。
     */
    async getCombinedNewsInspiration() {
        const sourceIds = ['hupu', 'douyin', 'weibo', 'hackernews', 'nowcoder']; 

        const fetchPromises = sourceIds.map(id => this.#fetchData(id));
        const results = await Promise.allSettled(fetchPromises);

        let allNews = [];
        results.forEach((result, index) => {
            const sourceId = sourceIds[index];
            if (result.status === 'fulfilled' && result.value) {
                const data = result.value;
                console.log(`[NewsInspirationService] Successfully fetched data from ${sourceId}`);
                switch (sourceId) {
                    case 'hupu': allNews.push(...this.#normalizeHupu(data)); break;
                    case 'douyin': allNews.push(...this.#normalizeDouyin(data)); break;
                    case 'weibo': allNews.push(...this.#normalizeWeibo(data)); break;
                    case 'hackernews': allNews.push(...this.#normalizeHackerNews(data)); break;
                    case 'nowcoder': allNews.push(...this.#normalizeNowcoder(data)); break;
                    default: console.warn(`[NewsInspirationService] Unknown source ID: ${sourceId}`);
                }
            } else if (result.status === 'rejected') {
                console.error(`[NewsInspirationService] Failed to fetch data from ${sourceId}:`, result.reason);
            }
        });

        // Sort by hotness (sources with explicit hotness will appear first)
        allNews.sort((a, b) => b.hotValue - a.hotValue);

        // Simple de-duplication based on normalized title
        const uniqueTitles = new Set();
        const deduplicatedNews = [];
        for (const newsItem of allNews) {
            const normalizedTitle = newsItem.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, ''); // Include Chinese chars
            if (!uniqueTitles.has(normalizedTitle)) {
                uniqueTitles.add(normalizedTitle);
                deduplicatedNews.push(newsItem);
            }
        }

        console.log(`[NewsInspirationService] Combined and deduplicated ${deduplicatedNews.length} news items.`);
        return deduplicatedNews;
    }

    /**
     * 生成用于AI内容创作的提示词。
     * @param {object} newsItem - 标准化后的新闻对象。
     * @returns {string} AI提示词。
     */
    generateContentPrompt(newsItem) {
        return `你是一位专业的"头条"平台内容创作者。请根据以下新闻热点，生成一篇吸引人的、结构清晰的头条风格文章。

要求：
1. 文章开头必须用 # 标记标题（例如：# 这是标题），标题不超过30个字
2. 标题后空一行开始正文
3. 不要包含任何解释性文字，直接开始文章
4. 内容要有深度、有思考，避免空洞的套话
5. 文章长度适中，450-900字左右

新闻标题: ${newsItem.title}
来源: ${newsItem.source}
链接: ${newsItem.url}
摘要: ${newsItem.description}

请基于这篇新闻，创作一篇高质量的自媒体文章。`;
    }
}

export { NewsInspirationService };
export default NewsInspirationService;