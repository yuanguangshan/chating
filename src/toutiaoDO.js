/**
 * 头条Durable Object - 独立的头条服务
 * 提供完整的头条内容生成和发布功能
 */

import { DurableObject } from "cloudflare:workers";
import { ToutiaoTaskProcessor, ToutiaoQueueManager, AIContentProcessor, ToutiaoPublisher } from './toutiaoService.js';

// 存储键常量
const TOUTIAO_QUEUE_KEY = 'toutiao_task_queue';
const TASK_RESULTS_KEY = 'toutiao_task_results';
const SERVICE_STATS_KEY = 'toutiao_service_stats';

/**
 * 头条服务Durable Object
 * 完全独立于聊天室功能的头条服务
 */
export class ToutiaoServiceDO2 extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        // 创建兼容的logger对象
        const logger = {
            log: (message, data) => this.logger(message, 'INFO', data),
            error: (message, error) => this.logger(message, 'ERROR', error)
        };
        this.processor = new ToutiaoTaskProcessor(env, logger);
        this.queueManager = new ToutiaoQueueManager(ctx.storage, logger);
        this.isInitialized = false;
    }

    /**
     * 日志记录器
     */
    logger(message, level = 'INFO', data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data,
            id: crypto.randomUUID().substring(0, 8)
        };

        if (data) {
            console.log(`[ToutiaoService] [${timestamp}] [${level}] ${message}`, data);
        } else {
            console.log(`[ToutiaoService] [${timestamp}] [${level}] ${message}`);
        }

        return logEntry;
    }

    /**
     * 初始化服务
     */
    async initialize() {
        if (this.isInitialized) return;

        // 初始化统计数据
        const stats = await this.ctx.storage.get(SERVICE_STATS_KEY) || {
            totalTasks: 0,
            successfulTasks: 0,
            failedTasks: 0,
            lastProcessedAt: null,
            createdAt: new Date().toISOString()
        };

        await this.ctx.storage.put(SERVICE_STATS_KEY, stats);
        this.isInitialized = true;
        this.logger('🚀 头条服务已初始化');
    }

    /**
     * 处理单个头条任务
     * @param {Object} task - 任务信息
     * @param {string} task.text - 用户输入
     * @param {string} task.username - 用户名
     * @param {string} task.id - 任务ID
     * @returns {Promise<Object>} 处理结果
     */
    async processTask(task) {
        await this.initialize();
        
        const result = await this.processor.processTask(task);
        
        // 更新统计信息
        await this.updateStats(result.success);
        
        // 保存结果
        await this.saveTaskResult(result);
        
        return result;
    }

    /**
     * 添加任务到队列
     * @param {Object} task - 任务信息
     * @returns {Promise<number>} 队列长度
     */
    async addTask(task) {
        await this.initialize();
        const queueLength = await this.queueManager.addTask(task);
        
        // 自动处理队列（如果队列长度小于等于3，立即处理）
        if (queueLength <= 3) {
            this.ctx.waitUntil(this.processQueue());
        }
        
        return queueLength;
    }

    /**
     * 处理队列中的所有任务
     * @returns {Promise<Array>} 处理结果
     */
    async processQueue() {
        await this.initialize();
        
        const results = await this.queueManager.processQueue(this.processor);
        
        // 保存结果并更新统计信息
        for (const result of results) {
            await this.saveTaskResult(result);
            await this.updateStats(result.success);
        }
        
        return results;
    }

    /**
     * 获取队列状态
     * @returns {Promise<Object>} 队列状态
     */
    async getQueueStatus() {
        await this.initialize();
        
        const queue = await this.queueManager.getQueue();
        return {
            length: queue.length,
            tasks: queue,
            lastProcessedAt: await this.getLastProcessedTime()
        };
    }

    /**
     * 获取服务统计信息
     * @returns {Promise<Object>} 统计信息
     */
    async getStats() {
        await this.initialize();
        return await this.ctx.storage.get(SERVICE_STATS_KEY);
    }

    /**
     * 获取任务结果
     * @param {string} taskId - 任务ID
     * @returns {Promise<Object>} 任务结果
     */
    async getTaskResult(taskId) {
        const results = await this.ctx.storage.get(TASK_RESULTS_KEY) || {};
        return results[taskId];
    }

    /**
     * 获取所有任务结果
     * @param {number} limit - 限制返回数量
     * @returns {Promise<Array>} 任务结果列表
     */
    async getAllTaskResults(limit = 50) {
        const results = await this.ctx.storage.get(TASK_RESULTS_KEY) || {};
        return Object.values(results)
            .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
            .slice(0, limit);
    }

    /**
     * 清理旧的任务结果
     * @param {number} daysToKeep - 保留天数
     * @returns {Promise<number>} 清理数量
     */
    async cleanupOldResults(daysToKeep = 7) {
        const results = await this.ctx.storage.get(TASK_RESULTS_KEY) || {};
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        let cleanedCount = 0;
        for (const [taskId, result] of Object.entries(results)) {
            if (new Date(result.completedAt) < cutoffDate) {
                delete results[taskId];
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            await this.ctx.storage.put(TASK_RESULTS_KEY, results);
            this.logger(`🧹 清理了 ${cleanedCount} 个过期任务结果`);
        }

        return cleanedCount;
    }

    /**
     * 更新统计信息
     * @param {boolean} success - 任务是否成功
     */
    async updateStats(success) {
        const stats = await this.ctx.storage.get(SERVICE_STATS_KEY) || {};
        stats.totalTasks = (stats.totalTasks || 0) + 1;
        
        if (success) {
            stats.successfulTasks = (stats.successfulTasks || 0) + 1;
        } else {
            stats.failedTasks = (stats.failedTasks || 0) + 1;
        }
        
        stats.lastProcessedAt = new Date().toISOString();
        await this.ctx.storage.put(SERVICE_STATS_KEY, stats);
    }

    /**
     * 保存任务结果
     * @param {Object} result - 任务结果
     */
    async saveTaskResult(result) {
        const results = await this.ctx.storage.get(TASK_RESULTS_KEY) || {};
        results[result.taskId] = {
            ...result,
            completedAt: new Date().toISOString()
        };
        await this.ctx.storage.put(TASK_RESULTS_KEY, results);
    }

    /**
     * 获取最后处理时间
     * @returns {Promise<string|null>}
     */
    async getLastProcessedTime() {
        const stats = await this.ctx.storage.get(SERVICE_STATS_KEY);
        return stats?.lastProcessedAt || null;
    }

    /**
     * 处理HTTP请求
     */
    async fetch(request) {
        const url = new URL(request.url);
        const method = request.method;

        this.logger(`📡 收到请求: ${method} ${url.pathname}`);

        try {
            switch (url.pathname) {
                case '/task':
                    if (method === 'POST') {
                        const task = await request.json();
                        const result = await this.processTask(task);
                        return new Response(JSON.stringify(result), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                    break;

                case '/queue':
                    if (method === 'POST') {
                        const task = await request.json();
                        const queueLength = await this.addTask(task);
                        return new Response(JSON.stringify({ queueLength }), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    } else if (method === 'GET') {
                        const status = await this.getQueueStatus();
                        return new Response(JSON.stringify(status), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    } else if (method === 'DELETE') {
                        const results = await this.processQueue();
                        return new Response(JSON.stringify({ results }), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                    break;

                case '/clearQueue':
                    if (method === 'POST') {
                        await this.ctx.storage.delete(TOUTIAO_QUEUE_KEY);
                        return new Response(JSON.stringify({ message: 'Queue cleared successfully' }), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                    break;
                case '/stats':
                    if (method === 'GET') {
                        const stats = await this.getStats();
                        return new Response(JSON.stringify(stats), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                    break;

                case '/results':
                    if (method === 'GET') {
                        const taskId = url.searchParams.get('id');
                        if (taskId) {
                            const result = await this.getTaskResult(taskId);
                            return new Response(JSON.stringify(result || null), {
                                headers: { 'Content-Type': 'application/json' }
                            });
                        } else {
                            const limit = parseInt(url.searchParams.get('limit')) || 50;
                            const results = await this.getAllTaskResults(limit);
                            return new Response(JSON.stringify(results), {
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }
                    }
                    break;

                case '/status':
                    if (method === 'GET') {
                        const parts = url.pathname.split('/');
                        const taskId = parts.length > 2 ? parts[2] : null; // 从 /status/{taskId} 提取 taskId
                        if (taskId) {
                            const result = await this.getTaskResult(taskId);
                            if (result) {
                                return new Response(JSON.stringify({
                                    taskId: taskId,
                                    status: result.status || 'unknown',
                                    message: result.message || '',
                                    completedAt: result.completedAt || null,
                                    error: result.error || null,
                                    data: result
                                }), {
                                    headers: { 'Content-Type': 'application/json' }
                                });
                            } else {
                                return new Response(JSON.stringify({
                                    taskId: taskId,
                                    status: 'not_found',
                                    message: '任务不存在或未找到'
                                }), {
                                    headers: { 'Content-Type': 'application/json' }
                                });
                            }
                        } else {
                            return new Response(JSON.stringify({
                                error: '缺少任务ID参数'
                            }), {
                                status: 400,
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }
                    }
                    break;

                case '/cleanup':
                    if (method === 'POST') {
                        const days = parseInt(url.searchParams.get('days')) || 7;
                        const cleaned = await this.cleanupOldResults(days);
                        return new Response(JSON.stringify({ cleaned }), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                    break;

                case '/health':
                    return new Response(JSON.stringify({
                        status: 'healthy',
                        timestamp: new Date().toISOString()
                    }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
            }

            return new Response('Not Found', { status: 404 });
        } catch (error) {
            this.logger(`❌ 请求处理失败: ${error.message}`, 'ERROR', error);
            return new Response(JSON.stringify({
                error: error.message,
                stack: error.stack
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
}

// 辅助函数，用于从聊天室调用
export class ToutiaoServiceClient {
    constructor(env, roomName = 'default') {
        this.env = env;
        this.roomName = roomName;
    }

    /**
     * 获取头条服务实例
     * @returns {Object} Durable Object 实例
     * @throws {Error} 如果头条服务未配置
     */
    getService() {
        if (!this.env.TOUTIAO_SERVICE_DO) {
            throw new Error('头条服务未配置：TOUTIAO_SERVICE_DO 环境变量缺失');
        }
        
        const doId = this.env.TOUTIAO_SERVICE_DO.idFromName(this.roomName);
        if (!doId) {
            throw new Error('无法创建头条服务实例');
        }
        
        return this.env.TOUTIAO_SERVICE_DO.get(doId);
    }

    /**
     * 提交任务到队列
     * @param {Object} task - 任务信息
     */
    async submitTask(task) {
        const service = this.getService();
        return await service.fetch('http://localhost/queue', {
            method: 'POST',
            body: JSON.stringify(task)
        }).then(r => r.json());
    }

    /**
     * 立即处理任务（不经过队列）
     * @param {Object} task - 任务信息
     */
    async processTask(task) {
        const service = this.getService();
        return await service.fetch('http://localhost/task', {
            method: 'POST',
            body: JSON.stringify(task)
        }).then(r => r.json());
    }

    /**
     * 处理队列中的所有待处理任务
     * @returns {Promise<Object>} 处理结果，包含 processedCount 字段
     */
    async processQueue() {
        try {
            const service = this.getService();
            const response = await service.fetch('http://localhost/queue', {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('处理头条队列时出错:', error);
            throw error;
        }
    }
}