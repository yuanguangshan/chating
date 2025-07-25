/**
 * 头条服务 - 独立的服务模块
 * 负责处理头条内容生成和发布的所有逻辑
 */

import { getGeminiChatAnswer } from "./ai.js";

// 头条文章模板配置
const TOUTIAO_TEMPLATES = {
  DEFAULT: `你是一位专业的"头条"平台内容创作者。请根据以下用户的原始请求，生成一篇吸引人的、结构清晰的头条风格文章。

要求：
1. 文章开头必须用 # 标记标题（例如：# 这是标题），标题不超过30个字
2. 标题后空一行开始正文
3. 不要包含任何解释性文字，直接开始文章
4. 内容要有深度、有思考，避免空洞的套话
5. 文章长度适中，450-900字左右

用户请求：{userInput}`,

  STORY: `你是一位擅长讲述故事的"头条"平台创作者。请根据以下用户的原始请求，创作一篇引人入胜的叙事性文章，以故事形式展现主题。

要求：
1. 文章开头必须用 # 标记标题（例如：# 这是标题），标题不超过30个字，富有故事感
2. 标题后空一行开始正文
3. 采用叙事手法，可以虚构人物、情节和对话，但主题要紧扣用户请求
4. 故事应有起承转合，包含冲突和解决方案
5. 语言生动形象，富有画面感和情感共鸣
6. 文章长度适中，450-900字左右

用户请求：{userInput}`,

  SCIENCE: `你是一位专业的科普"头条"平台创作者。请根据以下用户的原始请求，创作一篇科学严谨且通俗易懂的科普文章。

要求：
1. 文章开头必须用 # 标记标题（例如：# 这是标题），标题不超过30个字，要体现科普特点
2. 标题后空一行开始正文
3. 内容应基于科学事实和研究，避免伪科学
4. 用通俗易懂的语言解释复杂概念，可适当使用比喻和类比
5. 结构清晰，可分为背景介绍、核心知识点解析、实际应用等部分
6. 在保持科学准确性的同时保持趣味性
7. 文章长度适中，450-900字左右

用户请求：{userInput}`,

  ZHIHU: `你是一位深度思考型"头条"平台创作者，风格类似知乎高质量回答。请根据以下用户的原始请求，创作一篇有理有据、见解独到的深度分析文章。

要求：
1. 文章开头必须用 # 标记标题（例如：# 这是标题），标题不超过30个字，要有思考深度
2. 标题后空一行开始正文
3. 结合理性分析和个人洞见，提供多角度思考
4. 论证充分，观点明确，可引用相关数据、案例或专业知识
5. 语言风格理性客观，但不失个人特色
6. 可适当提出问题引发读者思考
7. 结尾应有总结或启发性观点
8. 文章长度适中，450-900字左右

用户请求：{userInput}`,
};

// 头条服务配置
const TOUTIAO_CONFIG = {
  MAX_TITLE_LENGTH: 30,
  DEFAULT_PROMPT_TEMPLATE: TOUTIAO_TEMPLATES.DEFAULT,
  PROCESSING_TIMEOUT: 300000, // 5分钟超时
  RETRY_ATTEMPTS: 3,
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
    if (!aiGeneratedText || typeof aiGeneratedText !== "string") {
      return {
        title: "内容生成异常",
        content: "抱歉，AI内容生成出现异常，请稍后重试。",
        summary: "内容生成异常，请重试...",
      };
    }

    let title = "精彩内容";
    let content = aiGeneratedText.trim();

    // 处理空内容
    if (!content) {
      return {
        title: "空内容警告",
        content: "AI返回了空内容，请检查输入或稍后重试。",
        summary: "内容为空，请重试...",
      };
    }

    // 规则1: 查找第一个H1-H6标题
    const headingMatch = content.match(/^(#{1,6})\s+(.+)/m);
    if (headingMatch && headingMatch[2]) {
      title = headingMatch[2].trim();
      content = content.replace(headingMatch[0], "").trim();
    } else {
      // 规则2: 智能标题生成
      const firstLine = content.split("\n")[0].trim();

      // 如果第一行合适作为标题
      if (
        firstLine.length > 0 &&
        firstLine.length <= TOUTIAO_CONFIG.MAX_TITLE_LENGTH
      ) {
        title = firstLine;
        const lines = content.split("\n");
        lines.shift();
        content = lines.join("\n").trim();
      } else {
        // 规则3: 从内容中提取关键短语作为标题
        const sentences = content
          .split(/[。！？\.\!\?]/)
          .filter((s) => s.trim().length > 5);
        if (sentences.length > 0) {
          const keyPhrase = sentences[0].substring(
            0,
            TOUTIAO_CONFIG.MAX_TITLE_LENGTH
          );
          title = keyPhrase.length > 10 ? keyPhrase : "深度思考";
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
    title = title
      .replace(/^["'""]/, "")
      .replace(/["'""]$/, "")
      .trim();
    if (title.length === 0) {
      title = "思考感悟";
    }

    // 生成摘要
    const cleanContent = content.replace(/^\s*[\r\n]+/gm, "");
    const summary =
      cleanContent.substring(0, 200).replace(/\s+/g, " ").trim() +
      (cleanContent.length > 200 ? "..." : "");

    return { title, content: cleanContent, summary };
  }

  /**
   * 验证标题是否符合要求
   * @param {string} title
   * @returns {{valid: boolean, reason: string}}
   */
  validateTitle(title) {
    if (!title || title.trim().length === 0) {
      return { valid: false, reason: "标题不能为空" };
    }
    if (title.length > TOUTIAO_CONFIG.MAX_TITLE_LENGTH) {
      return {
        valid: false,
        reason: `标题长度超过${TOUTIAO_CONFIG.MAX_TITLE_LENGTH}字限制`,
      };
    }
    return { valid: true, reason: "" };
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
    const flaskProxyUrl = `${this.env.FLASK_API || "https://api.yuangs.cc"}/api/toutiaopost`;
    if (!this.env.FLASK_API) {
      console.warn("⚠️ 未配置FLASK_API环境变量，使用默认值");
    }

    this.logger.log(`🚀 准备通过代理 ${flaskProxyUrl} 发布到头条...`, {
      title,
    });

    const payload = {
      title,
      content,
      ...options,
    };

    let lastError;
    for (let attempt = 1; attempt <= TOUTIAO_CONFIG.RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(flaskProxyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "ToutiaoService/1.0",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        this.logger.log("✅ 成功通过代理提交到头条", data);

        return {
          success: true,
          data,
          attempt,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        lastError = error;
        this.logger.log(
          `💥 发布尝试 ${attempt} 失败: ${error.message}`,
          "ERROR"
        );

        if (attempt < TOUTIAO_CONFIG.RETRY_ATTEMPTS) {
          await this.delay(1000 * attempt); // 指数退避
        }
      }
    }

    throw new Error(
      `发布失败，已尝试${TOUTIAO_CONFIG.RETRY_ATTEMPTS}次: ${lastError.message}`
    );
  }

  /**
   * 延迟函数
   * @param {number} ms
   * @returns {Promise}
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
   * 根据用户输入内容自动判断适合的文章风格
   * @param {string} userInput - 用户输入文本
   * @returns {string} - 选择的提示词模板
   */
  determinePromptTemplate(userInput) {
    // 故事型特征词
    const storyKeywords = [
      "故事",
      "讲述",
      "经历",
      "回忆",
      "发生",
      "那一天",
      "曾经",
      "情节",
      "童话",
      "小说",
      "传说",
      "神话",
      "人物",
      "剧情",
    ];

    // 科普型特征词
    const scienceKeywords = [
      "科学",
      "原理",
      "研究",
      "发现",
      "技术",
      "为什么",
      "怎么回事",
      "分析",
      "解释",
      "介绍",
      "科普",
      "知识",
      "学习",
      "探索",
    ];

    // 知乎型特征词
    const zhihuKeywords = [
      "思考",
      "观点",
      "看法",
      "认为",
      "分析",
      "辩论",
      "争议",
      "角度",
      "深度",
      "本质",
      "价值",
      "意义",
      "反思",
      "批判",
      "评价",
    ];

    // 计数各类型关键词出现次数
    let storyCount = 0;
    let scienceCount = 0;
    let zhihuCount = 0;

    // 检查用户输入中的关键词
    storyKeywords.forEach((keyword) => {
      if (userInput.includes(keyword)) storyCount++;
    });

    scienceKeywords.forEach((keyword) => {
      if (userInput.includes(keyword)) scienceCount++;
    });

    zhihuKeywords.forEach((keyword) => {
      if (userInput.includes(keyword)) zhihuCount++;
    });

    // 检查输入长度和复杂度
    const inputLength = userInput.length;
    const containsQuestion =
      userInput.includes("?") || userInput.includes("？");

    // 判断最适合的类型
    if (storyCount > scienceCount && storyCount > zhihuCount) {
      this.logger.log(`📖 检测到故事型内容，使用故事模板`);
      return TOUTIAO_TEMPLATES.STORY;
    } else if (scienceCount > storyCount && scienceCount > zhihuCount) {
      this.logger.log(`🔬 检测到科普型内容，使用科普模板`);
      return TOUTIAO_TEMPLATES.SCIENCE;
    } else if (
      (zhihuCount > storyCount && zhihuCount > scienceCount) ||
      (inputLength > 50 && containsQuestion)
    ) {
      this.logger.log(`🤔 检测到知乎型内容，使用知乎风格模板`);
      return TOUTIAO_TEMPLATES.ZHIHU;
    } else {
      this.logger.log(`📝 使用默认通用模板`);
      return TOUTIAO_TEMPLATES.DEFAULT;
    }
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

      // 1. 自动判断适合的风格
      const promptTemplate = this.determinePromptTemplate(text);

      // 2. 生成AI内容
      const prompt = promptTemplate.replace("{userInput}", text);
      const generatedText = await getGeminiChatAnswer(prompt, [], this.env);

      this.logger.log(
        `🤖 AI原始返回内容: ${generatedText ? generatedText.substring(0, 200) + "..." : "空内容"}`
      );

      // 3. 处理内容
      const { title, content, summary } =
        this.contentProcessor.processAIText(generatedText);

      // 4. 验证标题
      const titleValidation = this.contentProcessor.validateTitle(title);
      if (!titleValidation.valid) {
        throw new Error(`标题验证失败: ${titleValidation.reason}`);
      }

      // 5. 发布到头条
      const publishResult = await this.publisher.publish(
        title,
        content,
        options
      );

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        taskId: id,
        title,
        content,
        summary,
        publishResult,
        processingTime,
        username,
        templateUsed:
          promptTemplate === TOUTIAO_TEMPLATES.DEFAULT
            ? "default"
            : promptTemplate === TOUTIAO_TEMPLATES.STORY
              ? "story"
              : promptTemplate === TOUTIAO_TEMPLATES.SCIENCE
                ? "science"
                : "zhihu",
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.log(
        `❌ 头条任务处理失败 [${id}]: ${error.message}`,
        "ERROR",
        error
      );

      return {
        success: false,
        taskId: id,
        error: error.message,
        processingTime,
        username,
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
          username: task.username,
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
    this.queueKey = "toutiao_task_queue";
  }

  /**
   * 添加任务到队列
   * @param {Object} task - 任务信息
   * @returns {Promise<number>} 当前队列长度
   */
  async addTask(task) {
    return await this.storage.transaction(async (txn) => {
      let queue = (await txn.get(this.queueKey)) || [];
      queue.push({
        ...task,
        enqueuedAt: new Date().toISOString(),
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
    const queueData = await this.storage.get(this.queueKey);
    if (!queueData) return [];

    try {
      return JSON.parse(queueData);
    } catch (error) {
      console.error("Error parsing queue data:", error);
      return [];
    }
  }

  /**
   * 清空队列
   * @returns {Promise<void>}
   */
  async clearQueue() {
    await this.storage.delete(this.queueKey);
    await this.updateStats(); // 清空后更新统计
    this.logger.log("Task queue has been cleared via API.");
  }

  /**
   * 获取已完成的结果
   * @returns {Promise<Array>}
   */
  async getResults() {
    return (await this.storage.get("toutiao_history")) || [];
  }

  /**
   * 获取统计数据
   * @returns {Promise<Object>}
   */
  async getStats() {
    const queue = await this.getQueue();
    const history = await this.getResults();
    const failedCount = history.filter((r) => !r.success).length;

    const stats = {
      pending: queue.length,
      completed: history.filter((r) => r.success).length,
      failed: failedCount,
    };
    return { success: true, stats: stats };
  }

  /**
   * 处理队列中的所有任务
   * @param {ToutiaoTaskProcessor} processor - 任务处理器实例
   * @returns {Promise<Array>} 处理结果
   */
  async processQueue(processor) {
    this.logger.log("Starting manual queue processing...");

    const queue = await this.getQueue();
    if (queue.length === 0) {
      this.logger.log("Queue is empty, nothing to process.");
      return [];
    }

    const results = [];
    // 注意：这里我们串行处理任务，以避免瞬间产生大量并发
    for (const task of queue) {
      // 从队列中移除当前任务
      // 这里不直接清空队列，而是逐个处理并移除，确保即使处理中断，未处理的任务仍在队列中
      let currentQueue = await this.getQueue();
      currentQueue = currentQueue.filter((t) => t.id !== task.id);
      await this.storage.put(this.queueKey, currentQueue);

      // 根据任务类型调用不同的处理逻辑
      if (task.command === "toutiao_article" || !task.command) {
        // 兼容旧任务没有command字段的情况
        // 这是来自管理面板或旧系统的任务
        const processorTask = {
          id: task.id,
          text: task.inspiration.contentPrompt || task.inspiration.title,
          username: task.username,
        };
        // 调用您已有的 processAndNotify 逻辑
        const result = await processor.processTask(
          processorTask,
          task.roomName
        ); // 使用传入的processor实例
        results.push(result);
      } else {
        // 这里可以处理其他类型的任务
        this.logger.log(
          `Skipping unknown task type in queue: ${task.command}`,
          "WARN"
        );
        results.push({
          success: false,
          taskId: task.id,
          error: `Unknown task type: ${task.command}`,
        });
      }

      // 更新统计数据
      await this.updateStats();
    }
    this.logger.log("Manual queue processing finished.");
    return results;
  }

  /**
   * 更新统计数据 (这是一个内部辅助方法)
   * @returns {Promise<void>}
   */
  async updateStats() {
    const queue = await this.getQueue();
    const results = await this.getResults();
    const failedCount = results.filter((r) => !r.success).length;

    const stats = {
      pending: queue.length,
      completed: results.filter((r) => r.success).length,
      failed: failedCount,
    };

    await this.storage.put("stats", stats);
    this.logger.log("Stats updated", "DEBUG", stats);
  }

  /**
   * 获取特定任务状态
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object>} 任务状态
   */
  async getTaskStatus(taskId) {
    const queue = await this.getQueue();
    const taskInQueue = queue.find((t) => t.id === taskId);

    if (taskInQueue) {
      return {
        found: true,
        task: taskInQueue,
        status: taskInQueue.status || "pending",
        position: queue.indexOf(taskInQueue) + 1,
        queueLength: queue.length,
        inQueue: true,
      };
    }

    const history = await this.getResults();
    const historicalTask = history.find((t) => t.id === taskId);

    if (historicalTask) {
      return {
        found: true,
        task: historicalTask,
        status: historicalTask.status || "completed",
        inQueue: false,
      };
    }

    return {
      found: false,
      error: "任务未找到",
    };
  }

  /**
   * 获取队列状态概览
   * @returns {Promise<Object>} 队列状态
   */
  async getQueueStatus() {
    const stats = await this.getStats();
    const queue = await this.getQueue();
    const history = await this.getResults();

    const completedTasks = history.filter((t) => t.success).slice(-10); // 最近10个成功任务

    return {
      totalInQueue: stats.stats.pending,
      pending: stats.stats.pending,
      completed: stats.stats.completed,
      failed: stats.stats.failed,
      completedToday: history.filter((t) => {
        const taskDate = new Date(t.createdAt);
        const today = new Date();
        return taskDate.toDateString() === today.toDateString();
      }).length,
      recentCompleted: completedTasks.map((t) => ({
        id: t.taskId,
        title: t.title,
        status: "completed",
        createdAt: t.timestamp || new Date().toISOString(), // 假设有时间戳
      })),
      queue: queue.map((t) => ({
        id: t.id,
        topic: t.topic || "未知",
        status: t.status || "pending",
        createdAt: t.enqueuedAt || new Date().toISOString(),
      })),
    };
  }
}

// 默认导出主要服务类
export { ToutiaoTaskProcessor as default };
