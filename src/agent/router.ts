import { getLogger } from '../logger/index.ts'
import type { Binding } from './schema.ts'
import type { AgentInstance } from './types.ts'

/**
 * 路由上下文：描述入站消息的元信息
 */
export interface RouteContext {
  channel: string        // "telegram" | "web" | "api"
  chatId: string
  sender?: string
  isGroup?: boolean
  content?: string       // 用于 trigger 匹配
  tags?: string[]        // web 前端传入的标签
}

/**
 * 路由表条目（用于 API 可视化）
 */
export interface RouteTableEntry {
  agentId: string
  agentName: string
  binding: Binding
}

/**
 * AgentRouter：基于 bindings 配置的消息路由系统
 *
 * 匹配优先级规则：
 * 1. chatIds 精确匹配（最高权重）
 * 2. condition 条件匹配（trigger + isGroup + sender）
 * 3. tags 标签匹配
 * 4. channel 渠道匹配
 * 5. "*" 通配符（最低权重）
 * 6. 同权重时按 priority 数值降序
 */
export class AgentRouter {
  private routeTable: Array<{ agentId: string; binding: Binding; agent: AgentInstance }> = []
  private defaultAgent: AgentInstance | undefined

  /**
   * 从所有 agent 的 bindings 构建路由表（按 priority 降序）
   */
  buildRouteTable(agents: Map<string, AgentInstance>): void {
    const logger = getLogger()
    this.routeTable = []
    this.defaultAgent = undefined

    for (const [agentId, agent] of agents) {
      const bindings = agent.config.bindings
      if (!bindings || bindings.length === 0) {
        // 没有 bindings 的 agent 不参与路由（除了 default）
        if (agentId === 'default') {
          this.defaultAgent = agent
        }
        continue
      }

      for (const binding of bindings) {
        this.routeTable.push({ agentId, binding, agent })
      }
    }

    // 按 priority 降序排列
    this.routeTable.sort((a, b) => (b.binding.priority ?? 0) - (a.binding.priority ?? 0))

    // 如果没有从 bindings 中找到 default agent，从 agents map 中找
    if (!this.defaultAgent) {
      this.defaultAgent = agents.get('default')
      if (!this.defaultAgent) {
        const first = agents.values().next()
        this.defaultAgent = first.done ? undefined : first.value
      }
    }

    logger.info({ routeCount: this.routeTable.length }, '路由表已构建')
  }

  /**
   * 路由决策：返回最佳匹配的 agent
   */
  resolve(ctx: RouteContext): AgentInstance | undefined {
    let bestMatch: { agent: AgentInstance; score: number } | undefined

    for (const entry of this.routeTable) {
      const score = this.calculateScore(entry.binding, ctx)
      if (score < 0) continue // 不匹配

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { agent: entry.agent, score }
      }
    }

    return bestMatch?.agent ?? this.defaultAgent
  }

  /**
   * 返回完整路由表（用于 API 可视化）
   */
  getRouteTable(): RouteTableEntry[] {
    return this.routeTable.map(({ agentId, binding, agent }) => ({
      agentId,
      agentName: agent.config.name,
      binding,
    }))
  }

  /**
   * 计算路由条目与上下文的匹配分数
   * 返回 -1 表示不匹配，否则返回分数（越高越优）
   */
  private calculateScore(binding: Binding, ctx: RouteContext): number {
    let score = binding.priority ?? 0

    // 渠道匹配
    if (binding.channel !== '*' && binding.channel !== ctx.channel) {
      return -1 // 渠道不匹配
    }

    // chatIds 精确匹配（最高权重）
    if (binding.chatIds && binding.chatIds.length > 0) {
      if (binding.chatIds.includes(ctx.chatId)) {
        score += 10000
      } else {
        return -1 // 有 chatIds 限制但不匹配
      }
    }

    // condition 条件匹配
    if (binding.condition) {
      const cond = binding.condition

      // isGroup 匹配
      if (cond.isGroup !== undefined && cond.isGroup !== ctx.isGroup) {
        return -1
      }

      // sender 匹配
      if (cond.sender && cond.sender !== ctx.sender) {
        return -1
      }

      // trigger 正则匹配
      if (cond.trigger && ctx.content) {
        try {
          const regex = new RegExp(cond.trigger, 'i')
          if (regex.test(ctx.content)) {
            score += 1000
          } else {
            return -1
          }
        } catch {
          return -1 // 无效正则
        }
      } else if (cond.trigger && !ctx.content) {
        return -1
      }

      score += 500 // 有条件且全部匹配
    }

    // tags 匹配
    if (binding.tags && binding.tags.length > 0 && ctx.tags) {
      const matched = binding.tags.some((tag) => ctx.tags!.includes(tag))
      if (matched) {
        score += 100
      } else {
        return -1 // 有 tags 限制但不匹配
      }
    } else if (binding.tags && binding.tags.length > 0 && !ctx.tags) {
      return -1 // 有 tags 限制但上下文无 tags
    }

    // 通配符渠道得分最低
    if (binding.channel === '*') {
      score -= 1
    }

    return score
  }
}
