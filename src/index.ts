import { loadEnv, getEnv } from './config/index.ts'
import { initLogger, getLogger } from './logger/index.ts'
import { initDatabase } from './db/index.ts'
import { EventBus } from './events/index.ts'
import { AgentManager, AgentQueue } from './agent/index.ts'
import { MessageRouter, TelegramChannel } from './channel/index.ts'
import { SkillsLoader } from './skills/index.ts'
import { MemoryManager } from './memory/index.ts'
import { Scheduler } from './scheduler/index.ts'
import { createApp } from './routes/index.ts'

async function main() {
  // 1. 加载环境变量
  loadEnv()
  const env = getEnv()

  // 2. 初始化日志
  const logger = initLogger()
  logger.info('ZoerClaw 启动中...')

  // 3. 初始化数据库
  initDatabase()

  // 4. 创建 EventBus
  const eventBus = new EventBus()

  // 5. 创建 SkillsLoader
  const skillsLoader = new SkillsLoader()
  logger.info({ count: skillsLoader.loadAllSkills().length }, 'Skills 加载完成')

  // 6. 创建 MemoryManager
  const memoryManager = new MemoryManager()

  // 7. 创建 AgentManager 并加载 agents
  const agentManager = new AgentManager(eventBus, skillsLoader)
  await agentManager.loadAgents()

  // 8. 创建 AgentQueue
  const agentQueue = new AgentQueue(agentManager)

  // 9. 创建 MessageRouter（带 MemoryManager）
  const router = new MessageRouter(agentManager, agentQueue, eventBus, memoryManager)

  // 10. 如果有 TELEGRAM_BOT_TOKEN，创建 TelegramChannel 并连接
  if (env.TELEGRAM_BOT_TOKEN) {
    const telegramChannel = new TelegramChannel(env.TELEGRAM_BOT_TOKEN, {
      onMessage: (message) => router.handleInbound(message),
    })
    router.addChannel(telegramChannel)

    telegramChannel.connect().catch((err) => {
      logger.error({ error: err }, 'Telegram 连接失败')
    })
    logger.info('Telegram channel 已配置')
  } else {
    logger.info('未配置 TELEGRAM_BOT_TOKEN，跳过 Telegram channel')
  }

  // 11. 创建 Scheduler 并启动
  const scheduler = new Scheduler(agentQueue, agentManager, eventBus)
  scheduler.start()
  logger.info('定时任务调度器已启动')

  // 12. 创建 HTTP 服务
  const app = createApp({ agentManager, agentQueue, eventBus, router, skillsLoader, memoryManager, scheduler })

  const server = Bun.serve({
    port: env.PORT,
    fetch: app.fetch,
  })

  logger.info({ port: env.PORT }, `HTTP 服务已启动: http://localhost:${env.PORT}`)
  logger.info('ZoerClaw 已就绪')

  // 13. 优雅关闭
  const shutdown = () => {
    logger.info('正在关闭...')
    scheduler.stop()
    server.stop()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('启动失败:', err)
  process.exit(1)
})
