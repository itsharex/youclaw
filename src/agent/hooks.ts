import { resolve } from 'node:path'
import { getLogger } from '../logger/index.ts'
import type { HooksConfig } from './schema.ts'

/**
 * Hook 生命周期阶段
 */
export type HookPhase =
  | 'pre_process'       // 消息进入 agent 前（可修改 prompt、可拒绝）
  | 'post_process'      // agent 回复后（可修改回复文本）
  | 'pre_tool_use'      // agent 调用工具前（可拦截、可修改参数）
  | 'post_tool_use'     // 工具执行后（可修改结果）
  | 'pre_compact'       // session compact 前（可归档完整对话）
  | 'on_error'          // 错误发生时
  | 'on_session_start'  // 新 session 创建时
  | 'on_session_end'    // session 结束时

/**
 * Hook 上下文：传递给 hook 脚本的数据
 */
export interface HookContext {
  agentId: string
  chatId: string
  phase: HookPhase
  payload: Record<string, unknown>
  modifiedPayload?: Record<string, unknown>
  abort?: boolean
  abortReason?: string
}

/**
 * Hook 处理函数签名
 */
export type HookHandler = (ctx: HookContext) => Promise<HookContext>

/**
 * 内部 hook 条目（含加载后的函数引用）
 */
interface LoadedHook {
  handler: HookHandler
  priority: number
  tools?: string[]     // pre_tool_use 专用：只对指定工具生效
  source: string       // 脚本路径或 'builtin'
}

const HOOK_TIMEOUT_MS = 5000

/**
 * HooksManager：管理 Agent 生命周期 hooks
 *
 * 支持：
 * - 从 agent.yaml 的 hooks 配置加载 .ts 脚本
 * - 内置 hook 注册（如安全策略）
 * - 按 priority 排序执行
 * - 5 秒超时保护
 * - 错误隔离（hook 报错不影响主流程）
 */
export class HooksManager {
  // agentId → phase → LoadedHook[]
  private hooks: Map<string, Map<HookPhase, LoadedHook[]>> = new Map()

  /**
   * 加载 agent 的 hooks 配置，动态 import() 脚本
   */
  async loadHooks(agentId: string, workspaceDir: string, hooksConfig: HooksConfig): Promise<void> {
    const logger = getLogger()
    const phases: HookPhase[] = [
      'pre_process', 'post_process', 'pre_tool_use', 'post_tool_use',
      'pre_compact', 'on_error', 'on_session_start', 'on_session_end',
    ]

    for (const phase of phases) {
      const entries = hooksConfig[phase]
      if (!entries || entries.length === 0) continue

      for (const entry of entries) {
        const scriptPath = resolve(workspaceDir, entry.script)

        try {
          const module = await import(scriptPath)
          const handler: HookHandler = module.default ?? module

          if (typeof handler !== 'function') {
            logger.warn({ agentId, script: entry.script }, 'Hook 脚本没有导出函数，跳过')
            continue
          }

          this.registerHook(agentId, phase, {
            handler,
            priority: entry.priority ?? 0,
            tools: entry.tools,
            source: scriptPath,
          })

          logger.info({ agentId, phase, script: entry.script }, 'Hook 已加载')
        } catch (err) {
          logger.error({
            agentId,
            phase,
            script: entry.script,
            error: err instanceof Error ? err.message : String(err),
          }, '加载 hook 脚本失败')
        }
      }
    }
  }

  /**
   * 注册内置 hook（如安全策略）
   */
  registerBuiltinHook(agentId: string, phase: HookPhase, handler: HookHandler, priority: number = 0): void {
    this.registerHook(agentId, phase, {
      handler,
      priority,
      source: 'builtin',
    })
  }

  /**
   * 执行 hook 链（按 priority 升序，数值越小越先执行；支持提前 abort）
   */
  async execute(agentId: string, phase: HookPhase, ctx: HookContext): Promise<HookContext> {
    const logger = getLogger()
    const agentHooks = this.hooks.get(agentId)
    if (!agentHooks) return ctx

    const phaseHooks = agentHooks.get(phase)
    if (!phaseHooks || phaseHooks.length === 0) return ctx

    let currentCtx = { ...ctx }

    for (const hook of phaseHooks) {
      // pre_tool_use 的 tools 过滤
      if (phase === 'pre_tool_use' && hook.tools && hook.tools.length > 0) {
        const tool = currentCtx.payload.tool as string
        if (!hook.tools.includes(tool)) {
          continue
        }
      }

      try {
        currentCtx = await this.executeWithTimeout(hook.handler, currentCtx, HOOK_TIMEOUT_MS)
      } catch (err) {
        logger.error({
          agentId,
          phase,
          source: hook.source,
          error: err instanceof Error ? err.message : String(err),
        }, 'Hook 执行失败（已跳过）')
        // hook 错误不影响主流程
        continue
      }

      // 检查 abort 标志
      if (currentCtx.abort) {
        logger.info({
          agentId,
          phase,
          source: hook.source,
          reason: currentCtx.abortReason,
        }, 'Hook 触发 abort')
        break
      }
    }

    return currentCtx
  }

  /**
   * 清理指定 agent 的 hooks（reload 时用）
   */
  unloadHooks(agentId: string): void {
    this.hooks.delete(agentId)
  }

  /**
   * 注册 hook 到内部存储
   */
  private registerHook(agentId: string, phase: HookPhase, hook: LoadedHook): void {
    if (!this.hooks.has(agentId)) {
      this.hooks.set(agentId, new Map())
    }

    const agentHooks = this.hooks.get(agentId)!
    if (!agentHooks.has(phase)) {
      agentHooks.set(phase, [])
    }

    const phaseHooks = agentHooks.get(phase)!
    phaseHooks.push(hook)

    // 按 priority 升序排序（数值越小优先级越高，越先执行）
    phaseHooks.sort((a, b) => a.priority - b.priority)
  }

  /**
   * 带超时的 hook 执行
   */
  private executeWithTimeout(handler: HookHandler, ctx: HookContext, timeoutMs: number): Promise<HookContext> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Hook 执行超时 (${timeoutMs}ms)`))
      }, timeoutMs)

      handler(ctx)
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((err) => {
          clearTimeout(timer)
          reject(err)
        })
    })
  }
}
