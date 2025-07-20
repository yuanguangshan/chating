/**
 * 知乎热点服务
 * 获取知乎实时热点话题和灵感问题
 */

export class ZhihuHotService {
    constructor() {
        this.apiUrl = 'https://newsnow.want.biz/api/s';
        this.inspirationApiUrl = 'https://www.zhihu.com/api/v4/creators/recommend/list';
        this.cacheKey = 'zhihu_hot_cache';
        this.inspirationCacheKey = 'zhihu_inspiration_cache';
        this.cacheDuration = 5 * 60 * 1000; // 5分钟缓存
        this.cache = {
            hotTopics: { timestamp: 0, data: null },
            inspirationQuestions: { timestamp: 0, data: null }
        };
    }

    /**
     * 获取知乎热点话题
     * @returns {Promise<Array>} 热点话题数组
     */
    async fetchZhihuHotTopics() {
        try {
            console.log('开始获取知乎热点数据...');
            
            // 检查内存缓存
            const now = Date.now();
            if (this.cache.hotTopics.data && now - this.cache.hotTopics.timestamp < this.cacheDuration) {
                console.log('从缓存中获取知乎热点数据');
                return this.cache.hotTopics.data;
            }
            
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
            
            // 更新缓存
            this.cache.hotTopics = { timestamp: now, data: topics };

            return topics;
        } catch (error) {
            console.error('获取知乎热点失败:', error.message);
            throw new Error(`获取知乎热点失败: ${error.message}`);
        }
    }

    /**
     * 获取知乎灵感问题
     * @param {number} pageSize 每页数量
     * @param {number} current 当前页码
     * @returns {Promise<Array>} 灵感问题数组
     */
    async fetchZhihuInspirationQuestions(pageSize = 100, current = 1) {
        try {
            console.log('开始获取知乎灵感问题数据...');
            
            // 检查内存缓存
            const now = Date.now();
            if (this.cache.inspirationQuestions.data && now - this.cache.inspirationQuestions.timestamp < this.cacheDuration) {
                console.log('从缓存中获取知乎灵感问题数据');
                return this.cache.inspirationQuestions.data;
            }
            
            const response = await fetch(`${this.inspirationApiUrl}?pageSize=${pageSize}&current=${current}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'ZhihuHybrid Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
                    'Accept-Encoding': 'gzip, deflate',
                    'Accept-Language': 'zh-CN,zh-Hans;q=0.9'
                }
            });

            if (!response.ok) {
                throw new Error(`知乎灵感问题API请求失败，状态码: ${response.status}`);
            }

            const data = await response.json();
            console.log('知乎灵感问题API响应:', data);

            // 根据实际API响应结构调整
            if (!data || !data.question_data) {
                throw new Error('知乎灵感问题API返回数据格式异常');
            }

            // 处理灵感问题数据
            const questions = this.processInspirationData(data.question_data);
            console.log(`成功获取 ${questions.length} 个知乎灵感问题`);
            
            // 更新缓存
            this.cache.inspirationQuestions = { timestamp: now, data: questions };

            return questions;
        } catch (error) {
            console.error('获取知乎灵感问题失败:', error.message);
            return this.getFallbackInspirationQuestions();
        }
    }

    /**
     * 处理知乎灵感问题数据
     * @param {Array} rawData 原始数据
     * @returns {Array} 处理后的灵感问题
     */
    processInspirationData(rawData) {
        if (!Array.isArray(rawData)) {
            return [];
        }

        return rawData.map(item => ({
            id: item.id || Math.random().toString(36).substr(2, 9),
            title: item.title || '无标题',
            url: `https://www.zhihu.com/question/${item.id}` || '#',
            hot: item.follower_count || 0,
            excerpt: item.excerpt || '',
            answer_count: item.answer_count || 0,
            category: '知乎灵感问题',
            timestamp: new Date().toISOString(),
            type: 'inspiration', // 标记类型为灵感问题
            tags: this.extractTagsFromQuestion(item)
        }));
    }

    /**
     * 从灵感问题中提取标签
     * @param {Object} question 问题对象
     * @returns {Array} 标签数组
     */
    extractTagsFromQuestion(question) {
        const tags = [];
        
        // 从标题中提取关键词作为标签
        if (question.title) {
            const titleWords = question.title.split(/[,，、\s]/).filter(word => 
                word.length >= 2 && word.length <= 6
            ).slice(0, 3);
            
            tags.push(...titleWords);
        }
        
        // 如果没有足够的标签，添加一些通用标签
        if (tags.length < 3) {
            const commonTags = ['灵感', '问题', '知乎', '创作', '讨论'];
            for (let i = 0; i < commonTags.length && tags.length < 5; i++) {
                if (!tags.includes(commonTags[i])) {
                    tags.push(commonTags[i]);
                }
            }
        }
        
        return tags;
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
            timestamp: new Date().toISOString(),
            type: 'hot' // 标记类型为热点话题
        }));
    }

    /**
     * 获取热门话题用于自媒体写作 (原有接口，保持不变)
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
                tags: this.extractTags(topic),
                type: 'hot'
            }));
        } catch (error) {
            console.error('获取知乎热点话题失败:', error);
            return this.getFallbackTopics();
        }
    }

    /**
     * 获取灵感问题用于创作
     * @param {number} limit 返回问题数量
     * @returns {Promise<Array>} 灵感问题
     */
    async getInspirationQuestionsForContent(limit = 10) {
        try {
            const questions = await this.fetchZhihuInspirationQuestions();
            
            if (!questions || questions.length === 0) {
                console.warn('未获取到知乎灵感问题，使用备用数据');
                return this.getFallbackInspirationQuestions();
            }
            
            // 按热度排序并取前N个
            const sortedQuestions = questions
                .sort((a, b) => {
                    const hotA = parseInt(a.hot) || 0;
                    const hotB = parseInt(b.hot) || 0;
                    return hotB - hotA;
                })
                .slice(0, limit);

            return sortedQuestions.map(question => ({
                title: question.title,
                hotValue: question.hot,
                url: question.url,
                excerpt: question.excerpt || '暂无描述',
                contentPrompt: this.generateInspirationPrompt(question),
                tags: question.tags || [],
                type: 'inspiration'
            }));
        } catch (error) {
            console.error('获取知乎灵感问题失败:', error);
            return this.getFallbackInspirationQuestions();
        }
    }

    /**
     * 获取热门话题和灵感问题的综合列表
     * @param {number} hotLimit 返回热点话题数量
     * @param {number} inspirationLimit 返回灵感问题数量
     * @returns {Promise<Object>} 包含热点和灵感的对象
     */
    async getCombinedTopics(hotLimit = 10, inspirationLimit = 10) {
        try {
            console.log('开始获取知乎综合内容数据...');

            // 并行获取热点话题和灵感问题
            const [hotTopics, inspirationQuestions] = await Promise.all([
                this.getHotTopicsForContent(hotLimit),
                this.getInspirationQuestionsForContent(inspirationLimit)
            ]);
            
            return {
                hotTopics: hotTopics,
                inspirationQuestions: inspirationQuestions,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('获取知乎综合内容失败:', error);
            return {
                hotTopics: this.getFallbackTopics(),
                inspirationQuestions: this.getFallbackInspirationQuestions(),
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * 生成灵感问题的内容创作提示
     * @param {Object} question 问题对象
     * @returns {string} 内容提示
     */
    generateInspirationPrompt(question) {
        return `请基于知乎灵感问题「${question.title}」写一篇原创回答。

问题背景：
${question.excerpt || '这是一个引起广泛讨论的问题，需要深入思考和专业观点。'}

回答要求：
1. 提供独特的视角和见解
2. 结合实际案例或数据支持观点
3. 回答结构清晰，逻辑严谨
4. 字数在800-1500字之间
5. 回答内容要有深度，避免泛泛而谈
6. 语言通俗易懂，适合大众阅读

请基于这个问题创作一篇高质量的知乎回答。`;
    }

    /**
     * 生成内容创作提示 (原有方法，保持不变)
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
     * 提取话题标签 (原有方法，保持不变)
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
            title.includes(tag) || (topic.excerpt && topic.excerpt.includes(tag))
        );
    }

    /**
     * 获取备用话题（当API失败时）(原有方法，保持不变)
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
                tags: ["AI", "工作", "科技", "未来", "趋势"],
                type: 'hot'
            },
            {
                title: "新能源汽车价格战：是福利还是陷阱？",
                hotValue: "1500万",
                url: "https://www.zhihu.com/question/ev_price",
                excerpt: "2024年以来，新能源汽车价格持续走低，消费者该如何选择...",
                contentPrompt: "分析新能源汽车价格战背后的原因、影响及消费者应对策略...",
                tags: ["新能源汽车", "价格战", "消费", "市场"],
                type: 'hot'
            },
            {
                title: "直播带货还能火多久？行业洗牌进行时",
                hotValue: "1200万",
                url: "https://www.zhihu.com/question/live_streaming",
                excerpt: "从薇娅李佳琦到东方甄选，直播带货行业经历了怎样的变迁...",
                contentPrompt: "分析直播带货行业的发展历程、现状及未来趋势，探讨行业洗牌的原因...",
                tags: ["直播带货", "电商", "行业", "趋势"],
                type: 'hot'
            },
            {
                title: "房价下跌时代，刚需现在该买房吗？",
                hotValue: "1800万",
                url: "https://www.zhihu.com/question/house_price",
                excerpt: "多地房价出现松动，刚需购房者面临艰难选择...",
                contentPrompt: "探讨房价下行周期中，刚需购房者的决策策略和注意事项...",
                tags: ["房价", "买房", "刚需", "投资"],
                type: 'hot'
            }
        ];
    }

    /**
     * 获取备用灵感问题（当API失败时）
     * @returns {Array} 备用灵感问题
     */
    getFallbackInspirationQuestions() {
        return [
            {
                title: "作为一个普通人，如何在日常生活中培养创造力？",
                hotValue: "1200万",
                url: "https://www.zhihu.com/question/creativity_daily",
                excerpt: "创造力不仅仅属于艺术家和科学家，每个人都可以在日常生活中培养这种能力...",
                contentPrompt: "请分享在日常生活中培养创造力的实用方法和习惯，以及如何将这些创意转化为实际成果...",
                tags: ["创造力", "自我提升", "思维", "习惯养成"],
                type: 'inspiration'
            },
            {
                title: "你认为什么样的教育方式最能激发孩子的学习兴趣？",
                hotValue: "980万",
                url: "https://www.zhihu.com/question/education_interest",
                excerpt: "面对应试教育的压力，如何保持孩子对学习的热情和好奇心成为许多家长关注的问题...",
                contentPrompt: "探讨能够有效激发孩子学习兴趣的教育理念和具体方法，结合实际案例分析...",
                tags: ["教育", "学习兴趣", "孩子成长", "家庭教育"],
                type: 'inspiration'
            },
            {
                title: "职场中，如何优雅地拒绝不合理的工作要求？",
                hotValue: "1560万",
                url: "https://www.zhihu.com/question/reject_work",
                excerpt: "在职场中，适当拒绝是一种必要的能力，但如何拒绝又不伤害工作关系...",
                contentPrompt: "分析职场中常见的不合理要求类型，并提供具体的拒绝策略和沟通技巧...",
                tags: ["职场", "沟通技巧", "边界感", "工作关系"],
                type: 'inspiration'
            },
            {
                title: "人到中年，如何重新定义自己的人生价值？",
                hotValue: "2100万",
                url: "https://www.zhihu.com/question/midlife_value",
                excerpt: "中年危机不仅仅是职业和家庭压力，更多的是对自我价值的重新思考...",
                contentPrompt: "探讨中年人如何面对人生转折期，重新审视自己的价值观和人生目标...",
                tags: ["中年", "人生价值", "自我实现", "心理健康"],
                type: 'inspiration'
            },
            {
                title: "极简主义生活方式真的能带来幸福感吗？",
                hotValue: "870万",
                url: "https://www.zhihu.com/question/minimalism",
                excerpt: "随着物质生活的丰富，越来越多的人开始追求极简主义生活...",
                contentPrompt: "分析极简主义的本质理念，以及它如何影响人们的生活质量和心理健康...",
                tags: ["极简主义", "生活方式", "幸福感", "消费观"],
                type: 'inspiration'
            }
        ];
    }

    /**
     * 基于知乎热点生成相关话题 (原有方法，保持不变)
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
            const mockResponse = await this.callGeminiAPI(prompt, topicKeyword);
            return this.parseGeneratedTopics(mockResponse, count);
        } catch (error) {
            console.error('生成相关话题失败:', error);
            return this.getRelatedFallbackTopics(topicKeyword);
        }
    }

    /**
     * 调用Gemini API生成话题 (原有方法，保持不变)
     * @param {string} prompt 提示词
     * @param {string} topicKeyword 话题关键词
     * @returns {Promise<string>} API响应
     */
    async callGeminiAPI(prompt, topicKeyword) {
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
     * 解析生成的相关话题内容 (原有方法，保持不变)
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
                        timestamp: Date.now(),
                        type: 'related'
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
     * 获取备用相关话题 (原有方法，保持不变)
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
                timestamp: Date.now(),
                type: 'related'
            },
            {
                title: `${keyword}对社会的深层影响`,
                excerpt: `探讨${keyword}如何改变我们的生活方式`,
                tags: ['社会', '影响', '变革'],
                url: '#',
                hot: 765,
                timestamp: Date.now(),
                type: 'related'
            },
            {
                title: `${keyword}的技术突破点`,
                excerpt: `分析${keyword}领域最新的技术突破`,
                tags: ['技术', '创新', '突破'],
                url: '#',
                hot: 654,
                timestamp: Date.now(),
                type: 'related'
            },
            {
                title: `${keyword}的商业化应用`,
                excerpt: `研究${keyword}在不同行业的商业应用`,
                tags: ['商业', '应用', '变现'],
                url: '#',
                hot: 543,
                timestamp: Date.now(),
                type: 'related'
            },
            {
                title: `${keyword}面临的挑战与解决方案`,
                excerpt: `讨论${keyword}发展过程中遇到的问题及解决思路`,
                tags: ['挑战', '解决方案', '思考'],
                url: '#',
                hot: 432,
                timestamp: Date.now(),
                type: 'related'
            }
        ];
        
        return fallbackTopics.slice(0, 10);
    }
}

export default ZhihuHotService;