import { resolve, isAbsolute } from 'node:path'
import type { SecurityConfig } from './schema.ts'
import type { HookHandler, HookContext } from './hooks.ts'

/**
 * 创建安全策略 hook
 *
 * 注册为最高优先级的 pre_tool_use hook（priority = -1000），
 * 在所有用户 hook 之前执行
 *
 * 支持：
 * - 工具白名单/黑名单
 * - 文件路径访问控制（allowedPaths / deniedPaths）
 */
export function createSecurityHook(securityConfig: SecurityConfig): HookHandler {
  const allowedTools = securityConfig.allowedTools
    ? new Set(securityConfig.allowedTools)
    : null
  const disallowedTools = securityConfig.disallowedTools
    ? new Set(securityConfig.disallowedTools)
    : null

  const allowedPaths = securityConfig.fileAccess?.allowedPaths
  const deniedPaths = securityConfig.fileAccess?.deniedPaths

  return async (ctx: HookContext): Promise<HookContext> => {
    const tool = ctx.payload.tool as string

    // 检查工具白名单
    if (allowedTools && !allowedTools.has(tool)) {
      ctx.abort = true
      ctx.abortReason = `工具 "${tool}" 不在允许列表中`
      return ctx
    }

    // 检查工具黑名单
    if (disallowedTools && disallowedTools.has(tool)) {
      ctx.abort = true
      ctx.abortReason = `工具 "${tool}" 被禁止使用`
      return ctx
    }

    // 检查文件路径访问（对文件操作工具生效）
    const fileTools = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep'])
    if (fileTools.has(tool) && (allowedPaths || deniedPaths)) {
      const input = ctx.payload.input as Record<string, unknown> | undefined
      const filePath = extractFilePath(tool, input)

      if (filePath) {
        const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)

        // 检查 deniedPaths
        if (deniedPaths) {
          for (const denied of deniedPaths) {
            const normalizedDenied = isAbsolute(denied) ? denied : resolve(process.cwd(), denied)
            if (normalizedPath.startsWith(normalizedDenied)) {
              ctx.abort = true
              ctx.abortReason = `文件路径 "${filePath}" 在禁止访问列表中`
              return ctx
            }
          }
        }

        // 检查 allowedPaths
        if (allowedPaths && allowedPaths.length > 0) {
          const allowed = allowedPaths.some((ap) => {
            const normalizedAllowed = isAbsolute(ap) ? ap : resolve(process.cwd(), ap)
            return normalizedPath.startsWith(normalizedAllowed)
          })
          if (!allowed) {
            ctx.abort = true
            ctx.abortReason = `文件路径 "${filePath}" 不在允许访问列表中`
            return ctx
          }
        }
      }
    }

    return ctx
  }
}

/**
 * 从工具输入中提取文件路径
 */
function extractFilePath(tool: string, input: Record<string, unknown> | undefined): string | null {
  if (!input) return null

  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return (input.file_path ?? input.path) as string | null
    case 'Glob':
    case 'Grep':
      return (input.path ?? input.directory) as string | null
    default:
      return null
  }
}
