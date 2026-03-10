import { getLogger } from '../logger/index.ts'
import type { AgentManager } from './manager.ts'

interface QueueItem {
  agentId: string
  chatId: string
  prompt: string
  resolve: (result: string) => void
  reject: (error: Error) => void
}

export class AgentQueue {
  private queues: Map<string, QueueItem[]> = new Map()   // agentId -> 队列
  private running: Map<string, boolean> = new Map()      // agentId -> 是否运行中
  private agentManager: AgentManager

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager
  }

  /**
   * 入队消息，返回 agent 回复
   * 同一个 agent 同时只处理一个任务，其余排队等待
   */
  async enqueue(agentId: string, chatId: string, prompt: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const queue = this.queues.get(agentId) ?? []
      queue.push({ agentId, chatId, prompt, resolve, reject })
      this.queues.set(agentId, queue)

      // 如果当前 agent 没有在运行，立即开始处理
      if (!this.running.get(agentId)) {
        this.processNext(agentId)
      }
    })
  }

  /**
   * 处理队列中的下一个任务
   */
  private async processNext(agentId: string): Promise<void> {
    const logger = getLogger()
    const queue = this.queues.get(agentId)

    if (!queue || queue.length === 0) {
      this.running.set(agentId, false)
      return
    }

    const item = queue.shift()!
    this.running.set(agentId, true)

    logger.debug(
      { agentId, chatId: item.chatId, queueLength: queue.length },
      '开始处理队列任务'
    )

    try {
      const managed = this.agentManager.getAgent(agentId)
      if (!managed) {
        throw new Error(`Agent not found: ${agentId}`)
      }

      const result = await managed.runtime.process({
        chatId: item.chatId,
        prompt: item.prompt,
        agentId: item.agentId,
      })

      item.resolve(result)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      logger.error({ agentId, chatId: item.chatId, error: error.message }, '队列任务处理失败')
      item.reject(error)
    }

    // 递归处理下一个任务
    await this.processNext(agentId)
  }
}
