import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import type { EventBus } from '../events/index.ts'
import type { SkillsLoader } from '../skills/index.ts'
import { AgentRuntime } from './runtime.ts'
import type { AgentConfig, ManagedAgent } from './types.ts'

export class AgentManager {
  private agents: Map<string, ManagedAgent> = new Map()
  private eventBus: EventBus
  private skillsLoader: SkillsLoader | null

  constructor(eventBus: EventBus, skillsLoader?: SkillsLoader) {
    this.eventBus = eventBus
    this.skillsLoader = skillsLoader ?? null
  }

  /**
   * 从 agents/ 目录加载所有 agent
   * 扫描每个子目录的 agent.yaml，解析配置并创建 AgentRuntime
   */
  async loadAgents(): Promise<void> {
    const logger = getLogger()
    const paths = getPaths()
    const agentsDir = paths.agents

    if (!existsSync(agentsDir)) {
      logger.warn({ agentsDir }, 'agents 目录不存在')
      return
    }

    const entries = readdirSync(agentsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const agentDir = resolve(agentsDir, entry.name)
      const configPath = resolve(agentDir, 'agent.yaml')

      if (!existsSync(configPath)) {
        logger.debug({ agentDir }, '跳过无 agent.yaml 的目录')
        continue
      }

      try {
        const rawYaml = readFileSync(configPath, 'utf-8')
        const parsed = parseYaml(rawYaml) as Record<string, unknown>

        const config: AgentConfig = {
          id: String(parsed.id ?? entry.name),
          name: String(parsed.name ?? entry.name),
          model: String(parsed.model ?? 'claude-sonnet-4-6'),
          workspaceDir: agentDir,
          trigger: parsed.trigger != null ? String(parsed.trigger) : undefined,
          requiresTrigger: parsed.requiresTrigger != null ? Boolean(parsed.requiresTrigger) : undefined,
          telegram: parsed.telegram != null ? this.parseTelegramConfig(parsed.telegram) : undefined,
          memory: parsed.memory != null ? { enabled: Boolean((parsed.memory as Record<string, unknown>).enabled) } : undefined,
          skills: Array.isArray(parsed.skills) ? (parsed.skills as unknown[]).map(String) : undefined,
        }

        const systemPrompt = this.buildSystemPrompt(agentDir, config)
        const runtime = new AgentRuntime(config, this.eventBus, systemPrompt)

        this.agents.set(config.id, {
          config,
          runtime,
          state: {
            sessionId: null,
            isProcessing: false,
          },
        })

        logger.info({ agentId: config.id, name: config.name }, 'Agent 已加载')
      } catch (err) {
        logger.error({ agentDir, error: err instanceof Error ? err.message : String(err) }, '加载 agent 失败')
      }
    }

    logger.info({ count: this.agents.size }, '所有 agent 加载完成')
  }

  /**
   * 根据 chatId 找到对应的 agent
   * 1. 遍历所有 agent 的 telegram.chatIds，找到匹配的
   * 2. 如果 chatId 以 "web:" 开头，返回默认 agent
   * 3. 如果没找到，返回 undefined
   */
  resolveAgent(chatId: string): ManagedAgent | undefined {
    // 遍历所有 agent，检查 telegram.chatIds 绑定
    for (const managed of this.agents.values()) {
      const chatIds = managed.config.telegram?.chatIds
      if (chatIds && chatIds.includes(chatId)) {
        return managed
      }
    }

    // web 渠道返回默认 agent
    if (chatId.startsWith('web:')) {
      return this.getDefaultAgent()
    }

    return undefined
  }

  /**
   * 获取所有 agent 配置列表
   */
  getAgents(): AgentConfig[] {
    return Array.from(this.agents.values()).map((m) => m.config)
  }

  /**
   * 获取单个 agent
   */
  getAgent(agentId: string): ManagedAgent | undefined {
    return this.agents.get(agentId)
  }

  /**
   * 获取默认 agent（第一个加载的）
   */
  getDefaultAgent(): ManagedAgent | undefined {
    // 优先返回 id 为 "default" 的 agent
    const defaultAgent = this.agents.get('default')
    if (defaultAgent) return defaultAgent

    // 否则返回第一个
    const first = this.agents.values().next()
    return first.done ? undefined : first.value
  }

  /**
   * 解析 telegram 配置
   */
  private parseTelegramConfig(raw: unknown): { chatIds?: string[] } | undefined {
    if (typeof raw !== 'object' || raw === null) return undefined
    const obj = raw as Record<string, unknown>
    return {
      chatIds: Array.isArray(obj.chatIds) ? (obj.chatIds as unknown[]).map(String) : undefined,
    }
  }

  /**
   * 构建 agent 的系统提示词
   * 读取 prompts/system.md + prompts/env.md + 合格 skills 内容
   */
  private buildSystemPrompt(_agentDir: string, agentConfig?: AgentConfig): string {
    const promptsDir = getPaths().prompts
    let prompt = ''

    // 加载基础系统提示词
    const systemPath = resolve(promptsDir, 'system.md')
    if (existsSync(systemPath)) {
      prompt += readFileSync(systemPath, 'utf-8')
    }

    // 加载并填充环境上下文
    const envPath = resolve(promptsDir, 'env.md')
    if (existsSync(envPath)) {
      let envPrompt = readFileSync(envPath, 'utf-8')
      envPrompt = envPrompt
        .replace('{{date}}', new Date().toISOString().split('T')[0]!)
        .replace('{{os}}', process.platform)
        .replace('{{platform}}', process.arch)
        .replace('{{cwd}}', process.cwd())
      prompt += '\n\n' + envPrompt
    }

    // 注入合格 skills 的内容
    if (this.skillsLoader && agentConfig) {
      const skills = this.skillsLoader.loadSkillsForAgent(agentConfig)
      const eligibleSkills = skills.filter((s) => s.eligible)

      if (eligibleSkills.length > 0) {
        prompt += '\n\n## Skills\n'
        for (const skill of eligibleSkills) {
          prompt += `\n### ${skill.name}\n${skill.content}\n`
        }
      }
    }

    return prompt
  }
}
