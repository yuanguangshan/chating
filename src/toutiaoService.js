/**
 * 头条服务 - 独立的服务模块
 * 负责处理头条内容生成和发布的所有逻辑
 */

import { getGeminiChatAnswer } from './ai.js';

// 头条服务配置
const TOUTIAO_CONFIG = {
    MAX_TITLE_LENGTH: 30,
    DEFAULT_PROMPT_TEMPLATE: `你是一位专业的"头条"平台内容创作者。请根据以下用户的原始请求，生成一篇吸引人的、结构清晰的头条风格文章。

要求：
1. 文章开头必须用 # 标记标题（例如：# 这是标题），标题不超过30个字
2. 标题后空一行开始正文
3. 不要包含任何解释性文字，直接开始文章
4. 内容要有深度、有思考，避免空洞的套话
5. 文章长度适中，500-1500字左右

用户请求：{userInput}`,
    PROCESSING_TIMEOUT: 300000, // 5分钟超时
    RETRY_ATTEMPTS: 3
};

/**
 * 内容处理器 - 负责处理AI生成的内容
 */
export class AIContentProcessor {
    /**
     * 从AI生成的Markdown文本中提取标题和内容
     * @param {string} aiGeneratedText - AI生成的完整Markdown文本
     * @returns {{title: string, content: string, summary: string}}
     */
    processAIText(aiGeneratedText) {
        // 处理空或无效内容
        if (!aiGeneratedText || typeof aiGeneratedText !== 'string') {
            return {
                title: '内容生成异常',
                content: '抱歉，AI内容生成出现异常，请稍后重试。',
                summary: '内容生成异常，请重试...'
            };
        }

        let title = '精彩内容';
        let content = aiGeneratedText.trim();

        // 处理空内容
        if (!content) {
            return {
                title: '空内容警告',
                content: 'AI返回了空内容，请检查输入或稍后重试。',
                summary: '内容为空，请重试...'
            };
        }

        // 规则1: 查找第一个H1或H2标题
        const headingMatch = content.match(/^(#|##)\s+(.+)/m);
        if (headingMatch && headingMatch[2]) {
            title = headingMatch[2].trim();
            content = content.replace(headingMatch[0], '').trim();
        } else {
            // 规则2: 智能标题生成
            const firstLine = content.split('\n')[0].trim();
            
            // 如果第一行合适作为标题
            if (firstLine.length > 0 && firstLine.length <= TOUTIAO_CONFIG.MAX_TITLE_LENGTH) {
                title = firstLine;
                const lines = content.split('\n');
                lines.shift();
                content = lines.join('\n').trim();
            } else {
                // 规则3: 从内容中提取关键短语作为标题
                const sentences = content.split(/[。！？\.\!\?]/).filter(s => s.trim().length > 5);
                if (sentences.length > 0) {
                    const keyPhrase = sentences[0].substring(0, TOUTIAO_CONFIG.MAX_TITLE_LENGTH);
                    title = keyPhrase.length > 10 ? keyPhrase : '深度思考';
                } else {
                    // 规则4: 从第一行截取合适长度
                    title = firstLine.substring(0, TOUTIAO_CONFIG.MAX_TITLE_LENGTH);
                }
            }
        }
        
        // 确保内容不为空
        if (!content.trim()) {
            content = aiGeneratedText.trim();
        }

        // 清理标题
        title = title.replace(/^["'“”]/, '').replace(/["'“”]$/, '').trim();
        if (title.length === 0) {
            title = '思考感悟';
        }

        // 生成摘要
        const cleanContent = content.replace(/^\s*[\r\n]+/gm, '');
        const summary = cleanContent.substring(0, 200).replace(/\s+/g, ' ').trim() + 
                       (cleanContent.length > 200 ? '...' : '');

        return { title, content: cleanContent, summary };
    }

    /**
     * 验证标题是否符合要求
     * @param {string} title 
     * @returns {{valid: boolean, reason: string}}
     */
    validateTitle(title) {
        if (!title || title.trim().length === 0) {
            return { valid: false, reason: '标题不能为空' };
        }
        if (title.length > TOUTIAO_CONFIG.MAX_TITLE_LENGTH) {
            return { valid: false, reason: `标题长度超过${TOUTIAO_CONFIG.MAX_TITLE_LENGTH}字限制` };
        }
        return { valid: true, reason: '' };
    }
}

/**
 * 头条发布服务
 */
export class ToutiaoPublisher {
    constructor(env, logger = null) {
        this.env = env;
        this.logger = logger || console;
    }

    /**
     * 发布内容到头条
     * @param {string} title - 文章标题
     * @param {string} content - 文章内容
     * @param {Object} options - 发布选项
     * @returns {Promise<Object>} 发布结果
     */
    async publish(title, content, options = {}) {
        const flaskProxyUrl = this.env.YOUR_FLASK_PROXY_API_URL;
        if (!flaskProxyUrl) {
            throw new Error('未配置 FLASK_PROXY_API_URL 环境变量');
        }

        this.logger.log(`🚀 准备通过代理 ${flaskProxyUrl} 发布到头条...`, { title });

        const payload = {
            title,
            content,
            ...options
        };

        let lastError;
        for (let attempt = 1; attempt <= TOUTIAO_CONFIG.RETRY_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(flaskProxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'ToutiaoService/1.0'
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                const data = await response.json();
                this.logger.log('✅ 成功通过代理提交到头条', data);
                
                return {
                    success: true,
                    data,
                    attempt,
                    timestamp: new Date().toISOString()
                };

            } catch (error) {
                lastError = error;
                this.logger.log(`💥 发布尝试 ${attempt} 失败: ${error.message}`, 'ERROR');
                
                if (attempt < TOUTIAO_CONFIG.RETRY_ATTEMPTS) {
                    await this.delay(1000 * attempt); // 指数退避
                }
            }
        }

        throw new Error(`发布失败，已尝试${TOUTIAO_CONFIG.RETRY_ATTEMPTS}次: ${lastError.message}`);
    }

    /**
     * 延迟函数
     * @param {number} ms 
     * @returns {Promise}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * 头条任务处理器
 */
export class ToutiaoTaskProcessor {
    constructor(env, logger = null) {
        this.env = env;
        this.logger = logger || console;
        this.contentProcessor = new AIContentProcessor();
        this.publisher = new ToutiaoPublisher(env, logger);
    }

    /**
     * 处理头条任务
     * @param {Object} task - 任务信息
     * @param {string} task.text - 用户输入文本
     * @param {string} task.username - 用户名
     * @param {string} task.id - 任务ID
     * @param {Object} options - 处理选项
     * @returns {Promise<Object>} 处理结果
     */
    async processTask(task, options = {}) {
        const { text, username, id } = task;
        const startTime = Date.now();

        try {
            this.logger.log(`📰 开始处理头条任务 [${id}]`, { username, text });

            // 1. 生成AI内容
            const prompt = TOUTIAO_CONFIG.DEFAULT_PROMPT_TEMPLATE.replace('{userInput}', text);
            const generatedText = await getGeminiChatAnswer(prompt, [], this.env);
            
            this.logger.log(`🤖 AI原始返回内容: ${generatedText ? generatedText.substring(0, 200) + '...' : '空内容'}`);

            // 2. 处理内容
            const { title, content, summary } = this.contentProcessor.processAIText(generatedText);

            // 3. 验证标题
            const titleValidation = this.contentProcessor.validateTitle(title);
            if (!titleValidation.valid) {
                throw new Error(`标题验证失败: ${titleValidation.reason}`);
            }

            // 4. 发布到头条
            const publishResult = await this.publisher.publish(title, content, options);

            const processingTime = Date.now() - startTime;
            
            return {
                success: true,
                taskId: id,
                title,
                content,
                summary,
                publishResult,
                processingTime,
                username
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            this.logger.log(`❌ 头条任务处理失败 [${id}]: ${error.message}`, 'ERROR', error);
            
            return {
                success: false,
                taskId: id,
                error: error.message,
                processingTime,
                username
            };
        }
    }

    /**
     * 批量处理任务队列
     * @param {Array} tasks - 任务列表
     * @param {Object} options - 处理选项
     * @returns {Promise<Array>} 处理结果列表
     */
    async processTaskQueue(tasks, options = {}) {
        const results = [];
        
        for (const task of tasks) {
            try {
                const result = await this.processTask(task, options);
                results.push(result);
            } catch (error) {
                results.push({
                    success: false,
                    taskId: task.id,
                    error: error.message,
                    username: task.username
                });
            }
        }

        return results;
    }
}

/**
 * 头条任务队列管理器
 */
export class ToutiaoQueueManager {
    constructor(storage, logger = null) {
        this.storage = storage;
        this.logger = logger || console;
        this.queueKey = 'toutiao_task_queue';
    }

    /**
     * 添加任务到队列
     * @param {Object} task - 任务信息
     * @returns {Promise<number>} 当前队列长度
     */
    async addTask(task) {
        return await this.storage.transaction(async (txn) => {
            let queue = await txn.get(this.queueKey) || [];
            queue.push({
                ...task,
                enqueuedAt: new Date().toISOString()
            });
            await txn.put(this.queueKey, queue);
            return queue.length;
        });
    }

    /**
     * 获取队列中的所有任务
     * @returns {Promise<Array>} 任务列表
     */
    async getQueue() {
        return await this.storage.get(this.queueKey) || [];
    }

    /**
     * 清空队列
     * @returns {Promise<void>}
     */
    async clearQueue() {
        await this.storage.delete(this.queueKey);
    }

    /**
     * 处理队列中的所有任务
     * @param {ToutiaoTaskProcessor} processor - 任务处理器实例
     * @returns {Promise<Array>} 处理结果
     */
    async processQueue(processor) {
        const queue = await this.getQueue();
        if (queue.length === 0) {
            return [];
        }

        await this.clearQueue();
        this.logger.log(`️ 开始处理队列中的 ${queue.length} 个任务`);
        
        return await processor.processTaskQueue(queue);
    }

    /**
     * 获取特定任务状态
     * @param {string} taskId - 任务ID
     * @returns {Promise<Object>} 任务状态
     */
    async getTaskStatus(taskId) {
        const queue = await this.getQueue();
        const task = queue.find(t => t.id === taskId);
        
        if (task) {
            return {
                found: true,
                task: task,
                status: task.status || 'pending',
                position: queue.indexOf(task) + 1,
                queueLength: queue.length
            };
        }
        
        // 检查历史记录
        const history = await this.storage.get('toutiao_history') || [];
        const historicalTask = history.find(t => t.id === taskId);
        
        if (historicalTask) {
            return {
                found: true,
                task: historicalTask,
                status: historicalTask.status || 'completed',
                inQueue: false
            };
        }
        
        return {
            found: false,
            error: '任务未找到'
        };
    }

    /**
     * 获取队列状态概览
     * @returns {Promise<Object>} 队列状态
     */
    async getQueueStatus() {
        const queue = await this.getQueue();
        const history = await this.storage.get('toutiao_history') || [];
        
        const pendingTasks = queue.filter(t => t.status === 'pending' || !t.status);
        const processingTasks = queue.filter(t => t.status === 'processing');
        const completedTasks = history.filter(t => t.status === 'completed').slice(-10); // 最近10个
        
        return {
            totalInQueue: queue.length,
            pending: pendingTasks.length,
            processing: processingTasks.length,
            completedToday: history.filter(t => {
                const taskDate = new Date(t.createdAt);
                const today = new Date();
                return taskDate.toDateString() === today.toDateString();
            }).length,
            recentCompleted: completedTasks,
            queue: queue.map(t => ({
                id: t.id,
                topic: t.topic,
                status: t.status || 'pending',
                createdAt: t.createdAt
            }))
        };
    }
}

// 默认导出主要服务类
export { ToutiaoTaskProcessor as default };