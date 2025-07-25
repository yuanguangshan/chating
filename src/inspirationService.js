/**
 * 灵感聚合服务 (Inspiration Aggregator Service)
 * 统一管理和聚合来自不同来源（知乎、新闻等）的创作灵感。
 */

import { ZhihuHotService } from "./zhihuHotService.js";
import { NewsInspirationService } from "./newsInspirationService.js";

export class InspirationService {
  constructor(env) {
    this.env = env;
    this.zhihuService = new ZhihuHotService(env);
    this.newsService = new NewsInspirationService(env);
  }

  /**
   * 将知乎条目标准化为统一的灵感格式
   * @param {object} item - 原始知乎条目
   * @param {string} source - 来源标识 (e.g., '知乎热点')
   * @returns {object} 标准化后的灵感对象
   */
  _normalizeZhihuItem(item, source) {
    return {
      id: `zhihu-${item.id || item.title}`,
      title: item.title,
      source: source,
      category: "知乎精选",
      hotValue: parseInt(item.hotValue) || 0,
      url: item.url,
      description: item.excerpt || "点击查看详情",
      tags: item.tags || [],
      contentPrompt: item.contentPrompt,
      timestamp: item.timestamp || new Date().toISOString(),
    };
  }

  /**
   * 将新闻条目标准化为统一的灵感格式
   * @param {object} item - 原始新闻条目
   * @returns {object} 标准化后的灵感对象
   */
  _normalizeNewsItem(item) {
    return {
      id: `${item.source.toLowerCase()}-${item.id}`,
      title: item.title,
      source: item.source, // e.g., '虎扑', '微博'
      category: item.type === "tech_news" ? "科技前沿" : "全网热点",
      hotValue: parseInt(item.hotValue) || 0,
      url: item.url,
      description: item.description,
      tags: [item.source, item.type === "tech_news" ? "科技" : "热点"],
      contentPrompt: this.newsService.generateContentPrompt(item), // 复用newsService的prompt生成逻辑
      timestamp: item.time || new Date().toISOString(),
    };
  }

  /**
   * 获取所有来源的、合并后的灵感列表
   * @param {object} limits - 各来源获取数量的限制
   * @param {number} limits.zhihuHot - 知乎热点数量
   * @param {number} limits.zhihuInspiration - 知乎灵感数量
   * @returns {Promise<Array>} 排序后的统一格式灵感列表
   */
  async getCombinedInspirations(
    limits = { zhihuHot: 10, zhihuInspiration: 10 }
  ) {
    console.log("🚀 开始整合全网灵感数据...");

    // 并发请求所有数据源，使用 Promise.allSettled 保证即使某个源失败也不影响其他源
    const [zhihuResult, newsResult] = await Promise.allSettled([
      this.zhihuService.getCombinedTopics(
        limits.zhihuHot,
        limits.zhihuInspiration
      ),
      this.newsService.getCombinedNewsInspiration(),
    ]);

    let combinedList = [];

    // 1. 处理知乎数据
    if (zhihuResult.status === "fulfilled" && zhihuResult.value) {
      const { hotTopics, inspirationQuestions } = zhihuResult.value;

      const zhihuHotNormalized = hotTopics.map((item) =>
        this._normalizeZhihuItem(item, "知乎热点")
      );
      const zhihuInspirationNormalized = inspirationQuestions.map((item) =>
        this._normalizeZhihuItem(item, "知乎灵感")
      );

      combinedList.push(...zhihuHotNormalized, ...zhihuInspirationNormalized);
      console.log(
        `[InspirationService] ✅ 成功整合 ${hotTopics.length} 个知乎热点和 ${inspirationQuestions.length} 个知乎灵感。`
      );
    } else if (zhihuResult.status === "rejected") {
      console.error(
        "[InspirationService] ❌ 获取知乎数据失败:",
        zhihuResult.reason
      );
    }

    // 2. 处理新闻数据
    if (newsResult.status === "fulfilled" && newsResult.value) {
      const newsItems = newsResult.value;
      const newsNormalized = newsItems.map((item) =>
        this._normalizeNewsItem(item)
      );
      combinedList.push(...newsNormalized);
      console.log(
        `[InspirationService] ✅ 成功整合 ${newsItems.length} 个新闻热点。`
      );
    } else if (newsResult.status === "rejected") {
      console.error(
        "[InspirationService] ❌ 获取新闻数据失败:",
        newsResult.reason
      );
    }

    // 3. 去重和排序
    // 基于标准化后的标题进行简单去重
    const uniqueTitles = new Set();
    const deduplicatedList = combinedList.filter((item) => {
      const normalizedTitle = item.title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
      if (uniqueTitles.has(normalizedTitle)) {
        return false;
      }
      uniqueTitles.add(normalizedTitle);
      return true;
    });

    // 按热度值降序排序
    deduplicatedList.sort((a, b) => b.hotValue - a.hotValue);

    console.log(
      `[InspirationService] ✨ 整合完成，共返回 ${deduplicatedList.length} 条高质量灵感。`
    );
    return deduplicatedList;
  }
}

export default InspirationService;
