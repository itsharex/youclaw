import { getLogger } from '../logger/index.ts'
import type { McpServerConfig } from './schema.ts'

/**
 * 解析 MCP 服务器配置中的环境变量引用（${VAR} → process.env.VAR）
 * 同时支持 ${SECRET:key} 格式的 secrets 引用（由 SecretsManager 预处理）
 */
export function resolveMcpServers(
  servers: Record<string, McpServerConfig>,
  extraEnv?: Record<string, string>,
): Record<string, McpServerConfig> {
  const logger = getLogger()
  const resolved: Record<string, McpServerConfig> = {}

  for (const [name, server] of Object.entries(servers)) {
    if (!server.env) {
      resolved[name] = server
      continue
    }

    const resolvedEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(server.env)) {
      const resolvedValue = value.replace(/\$\{(\w+)\}/g, (_, varName) => {
        // 优先从 extraEnv 中查找（SecretsManager 注入的）
        if (extraEnv && varName in extraEnv) {
          return extraEnv[varName]!
        }
        const envVal = process.env[varName]
        if (!envVal) {
          logger.warn({ mcpServer: name, envVar: varName }, 'MCP 服务器所需环境变量未定义，跳过该变量')
        }
        return envVal ?? ''
      })
      // 跳过解析后为空的环境变量，避免传空字符串导致 MCP 进程崩溃
      if (resolvedValue) {
        resolvedEnv[key] = resolvedValue
      }
    }
    resolved[name] = { ...server, env: resolvedEnv }
  }

  return resolved
}
