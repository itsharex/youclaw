import { getLogger } from '../logger/index.ts'
import type { McpServerConfig } from './schema.ts'

/**
 * SecretsManager：Agent 级别的 secrets 管理
 *
 * 约定命名规范：YOUCLAW_SECRET_<AGENTID>_<KEY>
 * 在 agent.yaml 中通过 ${SECRET:key} 引用
 *
 * 例如：
 * .env:
 *   YOUCLAW_SECRET_MYAGENT_API_TOKEN=sk-xxx
 *
 * agent.yaml:
 *   mcpServers:
 *     my-server:
 *       env:
 *         TOKEN: "${SECRET:api_token}"
 */
export class SecretsManager {
  // agentId -> key -> value
  private secrets: Map<string, Map<string, string>> = new Map()

  /**
   * 从 process.env 中加载按 agent 隔离的 secrets
   */
  loadFromEnv(): void {
    const logger = getLogger()
    const prefix = 'YOUCLAW_SECRET_'
    let count = 0

    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith(prefix) || !value) continue

      // YOUCLAW_SECRET_<AGENTID>_<KEY>
      const rest = key.slice(prefix.length)
      const firstUnderscore = rest.indexOf('_')

      if (firstUnderscore === -1) {
        logger.warn({ key }, '无效的 secret 命名格式，应为 YOUCLAW_SECRET_<AGENTID>_<KEY>')
        continue
      }

      const agentId = rest.slice(0, firstUnderscore).toLowerCase()
      const secretKey = rest.slice(firstUnderscore + 1).toLowerCase()

      if (!this.secrets.has(agentId)) {
        this.secrets.set(agentId, new Map())
      }
      this.secrets.get(agentId)!.set(secretKey, value)
      count++
    }

    if (count > 0) {
      logger.info({ count }, 'Agent secrets 加载完成')
    }
  }

  /**
   * 解析字符串模板中的 ${SECRET:key} 引用
   */
  resolve(agentId: string, template: string): string {
    const agentSecrets = this.secrets.get(agentId)
    if (!agentSecrets) return template

    return template.replace(/\$\{SECRET:(\w+)\}/g, (_, key: string) => {
      const value = agentSecrets.get(key.toLowerCase())
      if (!value) {
        getLogger().warn({ agentId, secretKey: key }, 'Secret 未找到')
        return ''
      }
      return value
    })
  }

  /**
   * 注入 secrets 到 MCP 服务器的 env 中
   * 预处理 ${SECRET:key} 引用，返回替换后的 servers 配置
   */
  injectToMcpEnv(agentId: string, servers: Record<string, McpServerConfig>): Record<string, McpServerConfig> {
    const agentSecrets = this.secrets.get(agentId)
    if (!agentSecrets || agentSecrets.size === 0) return servers

    const result: Record<string, McpServerConfig> = {}
    for (const [name, server] of Object.entries(servers)) {
      if (!server.env) {
        result[name] = server
        continue
      }

      const resolvedEnv: Record<string, string> = {}
      for (const [key, value] of Object.entries(server.env)) {
        resolvedEnv[key] = this.resolve(agentId, value)
      }
      result[name] = { ...server, env: resolvedEnv }
    }

    return result
  }

  /**
   * 获取指定 agent 的 secret 列表（仅返回 key 名，不返回值）
   */
  getSecretKeys(agentId: string): string[] {
    const agentSecrets = this.secrets.get(agentId)
    if (!agentSecrets) return []
    return Array.from(agentSecrets.keys())
  }
}
