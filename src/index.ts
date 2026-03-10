import { loadEnv, getEnv } from './config/index.ts'
import { initLogger, getLogger } from './logger/index.ts'
import { initDatabase } from './db/index.ts'
import { EventBus } from './events/index.ts'
import { AgentManager, AgentQueue } from './agent/index.ts'
import { MessageRouter, TelegramChannel } from './channel/index.ts'
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

  // 5. 创建 AgentManager 并加载 agents
  const agentManager = new AgentManager(eventBus)
  await agentManager.loadAgents()

  // 6. 创建 AgentQueue
  const agentQueue = new AgentQueue(agentManager)

  // 7. 创建 MessageRouter
  const router = new MessageRouter(agentManager, agentQueue, eventBus)

  // 8. 如果有 TELEGRAM_BOT_TOKEN，创建 TelegramChannel 并连接
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

  // 9. 创建 HTTP 服务
  const app = createApp(agentManager, agentQueue, eventBus, router)

  const server = Bun.serve({
    port: env.PORT,
    fetch: app.fetch,
  })

  logger.info({ port: env.PORT }, `HTTP 服务已启动: http://localhost:${env.PORT}`)
  logger.info('ZoerClaw 已就绪')

  // 10. 优雅关闭
  const shutdown = () => {
    logger.info('正在关闭...')
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
