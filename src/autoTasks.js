/*
 * 自动化任务均在此撰写
 */
import { generateAndPostCharts } from './chart_generator.js'
import { getDeepSeekExplanation, getKimiExplanation } from './ai.js'
import {
  fetchNewsFromTongHuaShun,
  fetchNewsFromDongFangCaiFu,
} from './newsService.js'
import { getFuturesData } from './futuresDataService.js'

/**
 * 1. 定义 Cron 表达式常量
 *    与 wrangler.toml 中的 [triggers].crons 保持一致
 */
const CRON_TRIGGERS = {
  // 规则一: 每日问候 (北京时间 08:00 -> UTC 00:00)
  DAILY_TEXT_MESSAGE: '0 0 * * *',

  // 规则二: 图表生成 (北京时间 周一至周五, 09:00-15:00 和 21:00-03:00)
  HOURLY_CHART_GENERATION: '0 1-7,13-19 * * 1-5',

  // 规则三: 新闻获取 (同上时间段, 每10分钟一次)
  FETCH_NEWS: '0 1-7,13-19 * * 1-5',

  // 规则四: 期货数据 (同上时间段, 每小时的第15分钟, 用于测试)
  TEST_FUTURES_DATA: '*/30 1-7,13-19 * * 1-5',

  // 新增：每30分钟处理一次头条队列
  PROCESS_TOUTIAO_QUEUE: '*/30 * * * *',
}

/**
 * 2. 定义独立的任务执行函数
 */

/**
 * 任务：发送每日文本消息
 * @param {object} env - 环境变量
 * @param {object} ctx - 执行上下文
 */
async function executeTextTask(env, ctx) {
  const roomName = 'test' // 目标房间

  // 基础提示词 (核心内容保持不变)
  const basePrompt =
    '忘掉我们之前的所有历史对话，现在你是deepseek小助手，自动向用户问好，并且每次附上一句名人名言，每日一句精典英文句子以及趣味数学知识点或数学家故事，并仔细分析名言。英文句子和数学知识点的意思及衍生意义，帮助用户提升自我，最后鼓励用户好好工作，好好学习，好好生活。'

  // 生成一个每次都不同的唯一标识符
  // crypto.randomUUID() 是生成标准 UUID 的推荐方式
  const uniqueId = crypto.randomUUID()

  // 或者，如果你只是需要一个递增的唯一标识符，也可以用时间戳，但UUID更独特：
  // const uniqueTimestamp = Date.now();

  // 在提示词中加入唯一标识符和明确的"不要重复"指令
  // 使用模板字符串 (backticks) 方便拼接
  const finalPrompt = `${basePrompt} 
    
请务必生成**全新的**、**未曾出现过**的内容。不要重复任何句子、名言或其解析。此次请求的唯一标识符是：${uniqueId}。在你回复的尾部，务必用方括号带上此${uniqueId}`

  console.log(`[Cron Task] Executing daily text task for room: ${roomName}`)
  try {
    if (!env.CHAT_ROOM_DO)
      throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.")

    // 调用 Kimi API 获取解释，可以配置使用不同的模型
    const content = await getKimiExplanation(finalPrompt, env)

    const doId = env.CHAT_ROOM_DO.idFromName(roomName)
    const stub = env.CHAT_ROOM_DO.get(doId)

    // 使用 RPC 调用 DO 的方法
    ctx.waitUntil(stub.cronPost(content, env.CRON_SECRET))

    console.log(
      `[Cron Task] Successfully dispatched text message to room: ${roomName}`,
    )
    return {
      success: true,
      roomName: roomName,
      message: '文本消息已成功发送。',
    }
  } catch (error) {
    console.error(`CRON ERROR (text task):`, error.stack || error)
    return { success: false, roomName: roomName, error: error.message }
  }
}

/**
 * 任务：生成并发布图表
 * @param {object} env - 环境变量
 * @param {object} ctx - 执行上下文
 */
async function executeChartTask(env, ctx) {
  const roomName = 'future' // 目标房间

  console.log(
    `[Cron Task] Executing chart generation task for room: ${roomName}`,
  )
  try {
    // generateAndPostCharts 是一个重量级操作，适合用 waitUntil 在后台执行
    ctx.waitUntil(generateAndPostCharts(env, roomName))

    console.log(
      `[Cron Task] Chart generation process dispatched for room: ${roomName}`,
    )
    return {
      success: true,
      roomName: roomName,
      message: '图表生成任务已分发。',
    }
  } catch (error) {
    console.error(`CRON ERROR (chart task):`, error.stack || error)
    return { success: false, roomName: roomName, error: error.message }
  }
}

/**
 * 任务：获取并发布新闻
 * @param {object} env - 环境变量
 * @param {object} ctx - 执行上下文
 */
async function executeNewsTask(env, ctx) {
  const roomName = 'future'
  console.log(`[Cron Task] Executing news fetching task for room: ${roomName}`)

  try {
    const [tonghuashunNews, dongfangcaifuNews] = await Promise.all([
      fetchNewsFromTongHuaShun().catch(e => {
        console.error(e)
        return []
      }),
      fetchNewsFromDongFangCaiFu().catch(e => {
        console.error(e)
        return []
      }),
    ])

    const allNews = [...tonghuashunNews, ...dongfangcaifuNews]

    if (allNews.length === 0) {
      console.log('[Cron Task] No news fetched, skipping post.')
      return
    }

    // 格式化新闻内容
    let newsContent = '## 财经新闻速递\n\n'
    allNews.forEach((item, index) => {
      newsContent += `${index + 1}. **${item.title}**\n`
      newsContent += `   - 热度: ${item.hot_value}\n`
      newsContent += `   - [阅读原文](${item.url})\n\n`
    })

    if (!env.CHAT_ROOM_DO)
      throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.")

    const doId = env.CHAT_ROOM_DO.idFromName(roomName)
    const stub = env.CHAT_ROOM_DO.get(doId)

    ctx.waitUntil(stub.cronPost(newsContent, env.CRON_SECRET))

    console.log(`[Cron Task] Successfully dispatched news to room: ${roomName}`)
    return { success: true, roomName: roomName, message: '新闻已成功发送。' }
  } catch (error) {
    console.error(`CRON ERROR (news task):`, error.stack || error)
    return { success: false, roomName: roomName, error: error.message }
  }
}

/**
 * 任务：测试获取期货数据
 * @param {object} env - 环境变量
 * @param {object} ctx - 执行上下文
 */
async function executeFuturesTestTask(env, ctx) {
  console.log(`[Cron Task] Executing futures data test task...`)
  try {
    const futuresData = await getFuturesData()
    console.log('--- Futures Data Test Result ---')
    console.log(JSON.stringify(futuresData, null, 2))
    console.log('--- End of Futures Data Test ---')

    // 为了防止重复执行，这个任务成功后可以考虑从 wrangler.toml 中移除
    // 或者在这里添加逻辑，只在特定条件下运行

    // 可以在这里将结果发送到特定房间进行验证
    const roomName = 'future' // 发送到 'future' 房间
    const content = `## 期货数据测试成功\n\n成功获取到 ${futuresData.length} 条数据。\n\n\`\`\`json\n${JSON.stringify(futuresData, null, 2)}\n\`\`\``

    if (!env.CHAT_ROOM_DO)
      throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.")

    const doId = env.CHAT_ROOM_DO.idFromName(roomName)
    const stub = env.CHAT_ROOM_DO.get(doId)

    ctx.waitUntil(stub.cronPost(content, env.CRON_SECRET))
    console.log(
      `[Cron Task] Successfully dispatched futures data test result to room: ${roomName}`,
    )
    return {
      success: true,
      roomName: roomName,
      message: '期货数据测试结果已发送。',
    }
  } catch (error) {
    console.error(`CRON ERROR (futures test task):`, error.stack || error)
    return { success: false, roomName: roomName, error: error.message }
  }
}

/**
 * 新增：处理头条队列的任务函数
 * @param {object} env - 环境变量
 * @param {object} ctx - 执行上下文
 */
async function executeToutiaoTask(env, ctx) {
  const roomName = 'test' // 目标房间，可根据需要修改

  console.log(
    `[Cron Task] Executing Toutiao queue processing for room: ${roomName}`,
  )
  try {
    if (!env.CHAT_ROOM_DO)
      throw new Error("Durable Object 'CHAT_ROOM_DO' is not bound.")

    const doId = env.CHAT_ROOM_DO.idFromName(roomName)
    const stub = env.CHAT_ROOM_DO.get(doId)

    // 使用 RPC 调用 DO 的新方法
    ctx.waitUntil(
      stub.processToutiaoQueue(env.CRON_SECRET).catch(error => {
        console.error(
          `[Cron Task] Toutiao queue processing failed for room: ${roomName}`,
          error,
        )
      }),
    )

    console.log(
      `[Cron Task] Successfully dispatched Toutiao queue processing to room: ${roomName}`,
    )
    return {
      success: true,
      roomName: roomName,
      message: '头条队列处理任务已分发。',
    }
  } catch (error) {
    console.error(`CRON ERROR (toutiao task):`, error.stack || error)
    return { success: false, roomName: roomName, error: error.message }
  }
}

/**
 * 3. 创建 Cron 表达式到任务函数的映射
 */
export const taskMap = new Map([
  [CRON_TRIGGERS.DAILY_TEXT_MESSAGE, executeTextTask],
  [CRON_TRIGGERS.HOURLY_CHART_GENERATION, executeChartTask],
  [CRON_TRIGGERS.FETCH_NEWS, executeNewsTask],
  [CRON_TRIGGERS.TEST_FUTURES_DATA, executeFuturesTestTask],
  [CRON_TRIGGERS.PROCESS_TOUTIAO_QUEUE, executeToutiaoTask],
])
