/**
 * 知乎热点服务
 * 获取知乎实时热点话题
 */

export class ZhihuHotService {
    constructor() {
        this.apiUrl = 'https://newsnow.want.biz/api/s';
        this.cacheKey = 'zhihu_hot_cache';
        this.cacheDuration = 5 * 60 * 1000; // 5分钟缓存
    }

    /**
     * 获取知乎热点话题
     * @returns {Promise<Array>} 热点话题数组
     */
    async fetchZhihuHotTopics() {
        try {
            console.log('开始获取知乎热点数据...');
            
            const response = await fetch(`${this.apiUrl}?id=zhihu`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`知乎热点API请求失败，状态码: ${response.status}`);
            }

            const data = await response.json();
            console.log('知乎热点API响应:', data);

            if (!data || !data.items) {
                throw new Error('知乎热点API返回数据格式异常');
            }

            // 处理数据格式
            const topics = this.processZhihuData(data.items);
            console.log(`成功获取 ${topics.length} 个知乎热点话题`);
            
            return topics;
        } catch (error) {
            console.error('获取知乎热点失败:', error.message);
            throw new Error(`获取知乎热点失败: ${error.message}`);
        }
    }

    /**
     * 处理知乎热点数据
     * @param {Array} rawData 原始数据
     * @returns {Array} 处理后的热点话题
     */
    processZhihuData(rawData) {
        if (!Array.isArray(rawData)) {
            return [];
        }

        return rawData.map(item => ({
            id: item.id || Math.random().toString(36).substr(2, 9),
            title: item.title || item.question || '无标题',
            url: item.url || item.link || '#',
            hot: (item.extra && item.extra.hot) || item.hot || item.hot_value || item.score || '0',
            excerpt: item.excerpt || item.desc || '',
            answers: item.answers || item.answer_count || 0,
            category: '知乎热点',
            timestamp: new Date().toISOString()
        }));
    }

    /**
     * 获取热门话题用于自媒体写作
     * @param {number} limit 返回话题数量
     * @returns {Promise<Array>} 精选热门话题
     */
    async getHotTopicsForContent(limit = 10) {
        try {
            const topics = await this.fetchZhihuHotTopics();
            
            if (!topics || topics.length === 0) {
                console.warn('未获取到知乎热点话题，使用备用数据');
                return this.getFallbackTopics();
            }
            
            // 按热度排序并取前N个
            const sortedTopics = topics
                .sort((a, b) => {
                    const hotA = parseInt(a.hot) || 0;
                    const hotB = parseInt(b.hot) || 0;
                    return hotB - hotA;
                })
                .slice(0, limit);

            return sortedTopics.map(topic => ({
                title: topic.title,
                hotValue: topic.hot,
                url: topic.url,
                excerpt: topic.excerpt,
                contentPrompt: this.generateContentPrompt(topic),
                tags: this.extractTags(topic)
            }));
        } catch (error) {
            console.error('获取知乎热点话题失败:', error);
            return this.getFallbackTopics();
        }
    }

    /**
     * 生成内容创作提示
     * @param {Object} topic 话题对象
     * @returns {string} 内容提示
     */
    generateContentPrompt(topic) {
        return `请围绕知乎热点话题「${topic.title}」写一篇深度分析文章。

话题背景：
${topic.excerpt}

文章要求：
1. 结合当前社会现象进行深入分析
2. 提供独特的观点和见解
3. 文章结构清晰，逻辑严谨
4. 字数在800-1500字之间
5. 标题要有吸引力，能引发读者共鸣

请基于这个话题创作一篇高质量的自媒体文章。`;
    }

    /**
     * 提取话题标签
     * @param {Object} topic 话题对象
     * @returns {Array} 标签数组
     */
    extractTags(topic) {
        const title = topic.title.toLowerCase();
        const commonTags = [
            '社会', '热点', '讨论', '观点', '深度', '分析',
            '知乎', '热议', '话题', '思考', '观察', '评论'
        ];
        
        return commonTags.filter(tag => 
            title.includes(tag) || topic.excerpt.includes(tag)
        );
    }

    /**
     * 获取备用话题（当API失败时）
     * @returns {Array} 备用话题
     */
    getFallbackTopics() {
        return [
            {
                title: "2025年AI将如何改变我们的工作方式？",
                hotValue: "2000万",
                url: "https://www.zhihu.com/question/ai2025",
                excerpt: "随着ChatGPT、Claude等AI工具的普及，越来越多的工作正在被重新定义...",
                contentPrompt: "请分析2025年AI技术对各行业工作方式的深度影响，包括机遇与挑战...",
                tags: ["AI", "工作", "科技", "未来", "趋势"]
            },
            {
                title: "新能源汽车价格战：是福利还是陷阱？",
                hotValue: "1500万",
                url: "https://www.zhihu.com/question/ev_price",
                excerpt: "2024年以来，新能源汽车价格持续走低，消费者该如何选择...",
                contentPrompt: "分析新能源汽车价格战背后的原因、影响及消费者应对策略...",
                tags: ["新能源汽车", "价格战", "消费", "市场"]
            },
            {
                title: "直播带货还能火多久？行业洗牌进行时",
                hotValue: "1200万",
                url: "https://www.zhihu.com/question/live_streaming",
                excerpt: "从薇娅李佳琦到东方甄选，直播带货行业经历了怎样的变迁...",
                contentPrompt: "分析直播带货行业的发展历程、现状及未来趋势，探讨行业洗牌的原因...",
                tags: ["直播带货", "电商", "行业", "趋势"]
            },
            {
                title: "房价下跌时代，刚需现在该买房吗？",
                hotValue: "1800万",
                url: "https://www.zhihu.com/question/house_price",
                excerpt: "多地房价出现松动，刚需购房者面临艰难选择...",
                contentPrompt: "探讨房价下行周期中，刚需购房者的决策策略和注意事项...",
                tags: ["房价", "买房", "刚需", "投资"]
            }
        ];
    }

    /**
     * 基于知乎热点生成相关话题
     * @param {string} topicKeyword 话题关键词
     * @param {number} count 生成话题数量
     * @returns {Promise<Array>} 生成的话题数组
     */
    async generateRelatedTopics(topicKeyword, count = 10) {
        try {
            const prompt = `基于知乎热点话题"${topicKeyword}"，请生成${count}个与之高度相关且有趣的话题。

要求：
1. 每个话题都要有独特视角
2. 话题要具有讨论性和传播性
3. 提供简短的话题描述
4. 格式为：
话题标题|话题描述|相关标签

请直接输出结果，不要添加额外说明。`;

            // 这里应该调用Gemini API，暂时使用模拟数据
            const mockResponse = await this.callGeminiAPI(prompt);
            return this.parseGeneratedTopics(mockResponse, count);
        } catch (error) {
            console.error('生成相关话题失败:', error);
            return this.getRelatedFallbackTopics(topicKeyword);
        }
    }

    /**
     * 调用Gemini API生成话题
     * @param {string} prompt 提示词
     * @returns {Promise<string>} API响应
     */
    async callGeminiAPI(prompt) {
        // 模拟Gemini API调用
        const topics = [
            `${topicKeyword}的未来发展趋势|深入分析${topicKeyword}在未来5年的发展方向和机遇|趋势,预测,机遇`,
            `${topicKeyword}对社会的深层影响|探讨${topicKeyword}如何改变我们的生活方式|社会,影响,变革`,
            `${topicKeyword}的技术突破点|分析${topicKeyword}领域最新的技术突破|技术,创新,突破`,
            `${topicKeyword}的商业化应用|研究${topicKeyword}在不同行业的商业应用|商业,应用,变现`,
            `${topicKeyword}面临的挑战与解决方案|讨论${topicKeyword}发展过程中遇到的问题及解决思路|挑战,解决方案,思考`
        ];
        return topics.join('\n');
    }

    /**
     * 解析生成的相关话题内容
     * @param {string} content 生成的内容
     * @param {number} maxCount 最大话题数量
     * @returns {Array} 解析后的话题数组
     */
    parseGeneratedTopics(content, maxCount = 10) {
        const topics = [];
        const lines = content.split('\n').filter(line => line.trim());
        
        for (let i = 0; i < Math.min(lines.length, maxCount); i++) {
            const line = lines[i].trim();
            if (line.includes('|')) {
                const parts = line.split('|');
                if (parts.length >= 3) {
                    topics.push({
                        title: parts[0].replace(/^[\d.\s]+/, '').trim(),
                        excerpt: parts[1].trim(),
                        tags: parts[2].split(',').map(tag => tag.trim()),
                        url: '#',
                        hot: Math.floor(Math.random() * 1000) + 100,
                        timestamp: Date.now()
                    });
                }
            }
        }
        
        // 如果没有解析到话题，使用备用方案
        if (topics.length === 0) {
            return this.getRelatedFallbackTopics('通用');
        }
        
        return topics;
    }

    /**
     * 获取备用相关话题
     * @param {string} keyword 关键词
     * @returns {Array} 备用话题数组
     */
    getRelatedFallbackTopics(keyword) {
        const fallbackTopics = [
            {
                title: `${keyword}的未来发展趋势`,
                excerpt: `深入分析${keyword}在未来5年的发展方向和机遇`,
                tags: ['趋势', '预测', '机遇'],
                url: '#',
                hot: 888,
                timestamp: Date.now()
            },
            {
                title: `${keyword}对社会的深层影响`,
                excerpt: `探讨${keyword}如何改变我们的生活方式`,
                tags: ['社会', '影响', '变革'],
                url: '#',
                hot: 765,
                timestamp: Date.now()
            },
            {
                title: `${keyword}的技术突破点`,
                excerpt: `分析${keyword}领域最新的技术突破`,
                tags: ['技术', '创新', '突破'],
                url: '#',
                hot: 654,
                timestamp: Date.now()
            },
            {
                title: `${keyword}的商业化应用`,
                excerpt: `研究${keyword}在不同行业的商业应用`,
                tags: ['商业', '应用', '变现'],
                url: '#',
                hot: 543,
                timestamp: Date.now()
            },
            {
                title: `${keyword}面临的挑战与解决方案`,
                excerpt: `讨论${keyword}发展过程中遇到的问题及解决思路`,
                tags: ['挑战', '解决方案', '思考'],
                url: '#',
                hot: 432,
                timestamp: Date.now()
            }
        ];
        
        return fallbackTopics.slice(0, 10);
    }
}

export default ZhihuHotService;