import { AgentManager } from '../agent/manager.ts'
import { AgentQueue } from '../agent/queue.ts'
import { EventBus } from '../events/bus.ts'
import { saveMessage, upsertChat } from '../db/index.ts'
import { randomUUID } from 'node:crypto'
import { getLogger } from '../logger/index.ts'
import type { MemoryManager } from '../memory/index.ts'
import type { InboundMessage, Channel } from './types.ts'

export class MessageRouter {
  private channels: Channel[] = []
  private memoryManager: MemoryManager | null = null

  constructor(
    private agentManager: AgentManager,
    private agentQueue: AgentQueue,
    private eventBus: EventBus,
    memoryManager?: MemoryManager,
  ) {
    if (memoryManager) {
      this.memoryManager = memoryManager
    }
    // 订阅 complete 事件，自动发送回复到对应 channel
    this.eventBus.subscribe({ types: ['complete'] }, (event) => {
      if (event.type === 'complete') {
        this.handleOutbound(event.chatId, event.fullText)
      }
    })
  }

  addChannel(channel: Channel) {
    this.channels.push(channel)
  }

  // 处理入站消息（从任何 channel 进来）
  async handleInbound(message: InboundMessage): Promise<void> {
    const logger = getLogger()

    // 解析 agent
    const managed = this.agentManager.resolveAgent(message.chatId)
    if (!managed) {
      logger.warn({ chatId: message.chatId }, '没有找到对应的 agent')
      return
    }

    const { config } = managed

    // 检查 trigger（群聊场景）
    if (message.isGroup && config.requiresTrigger !== false) {
      const trigger = config.trigger ? new RegExp(config.trigger, 'i') : null
      if (trigger && !trigger.test(message.content)) {
        return // 群聊中没被触发，忽略
      }
    }

    // 存入数据库
    upsertChat(message.chatId, config.id, message.senderName, message.chatId.startsWith('tg:') ? 'telegram' : 'web')
    saveMessage({
      id: message.id,
      chatId: message.chatId,
      sender: message.sender,
      senderName: message.senderName,
      content: message.content,
      timestamp: message.timestamp,
      isFromMe: false,
      isBotMessage: false,
    })

    logger.info({ agentId: config.id, chatId: message.chatId }, '路由消息到 agent')

    // 入队处理
    try {
      const reply = await this.agentQueue.enqueue(config.id, message.chatId, message.content)

      // 存储 bot 回复
      saveMessage({
        id: randomUUID(),
        chatId: message.chatId,
        sender: 'assistant',
        senderName: config.name,
        content: reply,
        timestamp: new Date().toISOString(),
        isFromMe: true,
        isBotMessage: true,
      })

      // 记录到每日日志
      if (this.memoryManager) {
        try {
          this.memoryManager.appendDailyLog(config.id, message.chatId, message.content, reply)
        } catch (logErr) {
          getLogger().error({ error: logErr, agentId: config.id }, '记录每日日志失败')
        }
      }
    } catch (err) {
      logger.error({ error: err, chatId: message.chatId }, '消息处理失败')
    }
  }

  // 处理出站消息（发送到对应 channel）
  private async handleOutbound(chatId: string, text: string) {
    for (const channel of this.channels) {
      if (channel.ownsChatId(chatId)) {
        try {
          await channel.sendMessage(chatId, text)
        } catch (err) {
          getLogger().error({ error: err, chatId }, 'channel 发送失败')
        }
        return
      }
    }
  }
}
