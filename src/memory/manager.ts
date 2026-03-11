import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'

const GLOBAL_AGENT_ID = '_global'

export class MemoryManager {
  private getAgentMemoryDir(agentId: string): string {
    const agentsDir = getPaths().agents
    return resolve(agentsDir, agentId, 'memory')
  }

  private getMemoryFilePath(agentId: string): string {
    return resolve(this.getAgentMemoryDir(agentId), 'MEMORY.md')
  }

  private getLogsDir(agentId: string): string {
    return resolve(this.getAgentMemoryDir(agentId), 'logs')
  }

  private ensureMemoryDir(agentId: string): void {
    const memoryDir = this.getAgentMemoryDir(agentId)
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true })
    }
  }

  private ensureLogsDir(agentId: string): void {
    const logsDir = this.getLogsDir(agentId)
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true })
    }
  }

  // ===== 全局 Memory =====

  /**
   * 获取全局 MEMORY.md 内容
   */
  getGlobalMemory(): string {
    return this.getMemory(GLOBAL_AGENT_ID)
  }

  /**
   * 更新全局 MEMORY.md
   */
  updateGlobalMemory(content: string): void {
    this.updateMemory(GLOBAL_AGENT_ID, content)
  }

  // ===== Agent Memory =====

  /**
   * 获取 agent 的 MEMORY.md 内容
   */
  getMemory(agentId: string): string {
    const filePath = this.getMemoryFilePath(agentId)

    if (!existsSync(filePath)) {
      return ''
    }

    return readFileSync(filePath, 'utf-8')
  }

  /**
   * 更新 agent 的 MEMORY.md
   */
  updateMemory(agentId: string, content: string): void {
    this.ensureMemoryDir(agentId)
    const filePath = this.getMemoryFilePath(agentId)
    writeFileSync(filePath, content, 'utf-8')
    getLogger().info({ agentId }, 'MEMORY.md 已更新')
  }

  /**
   * 截断文本到指定长度
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + `... *(${text.length} chars total)*`
  }

  /**
   * 追加每日日志（支持截断）
   */
  appendDailyLog(agentId: string, chatId: string, userMessage: string, botReply: string, maxLogEntryLength?: number): void {
    this.ensureLogsDir(agentId)

    const maxLen = maxLogEntryLength ?? 500
    const truncatedUser = this.truncate(userMessage, Math.min(maxLen, 300))
    const truncatedReply = this.truncate(botReply, maxLen)

    const now = new Date()
    const date = now.toISOString().split('T')[0]!
    const time = now.toTimeString().slice(0, 5)
    const logPath = resolve(this.getLogsDir(agentId), `${date}.md`)

    const entry = `\n## ${time} [${chatId}]\n**User**: ${truncatedUser}\n**Assistant**: ${truncatedReply}\n`

    let existing = ''
    if (existsSync(logPath)) {
      existing = readFileSync(logPath, 'utf-8')
    } else {
      existing = `# ${date}\n`
    }

    writeFileSync(logPath, existing + entry, 'utf-8')
    getLogger().debug({ agentId, date }, '每日日志已追加')
  }

  /**
   * 获取每日日志列表（返回日期数组，降序排列）
   */
  getDailyLogDates(agentId: string): string[] {
    const logsDir = this.getLogsDir(agentId)

    if (!existsSync(logsDir)) {
      return []
    }

    const files = readdirSync(logsDir)
    return files
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace('.md', ''))
      .sort((a, b) => b.localeCompare(a))
  }

  /**
   * 获取某天的日志内容
   */
  getDailyLog(agentId: string, date: string): string {
    const logPath = resolve(this.getLogsDir(agentId), `${date}.md`)

    if (!existsSync(logPath)) {
      return ''
    }

    return readFileSync(logPath, 'utf-8')
  }

  /**
   * 清理超期日志文件
   */
  pruneOldLogs(agentId: string, retainDays: number = 30): number {
    const logsDir = this.getLogsDir(agentId)
    if (!existsSync(logsDir)) return 0

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - retainDays)
    const cutoffStr = cutoff.toISOString().split('T')[0]!

    const files = readdirSync(logsDir).filter((f) => f.endsWith('.md'))
    let deleted = 0
    for (const file of files) {
      const date = file.replace('.md', '')
      if (date < cutoffStr) {
        unlinkSync(resolve(logsDir, file))
        deleted++
      }
    }

    if (deleted > 0) {
      getLogger().info({ agentId, deleted, retainDays }, '旧日志已清理')
    }
    return deleted
  }

  /**
   * 获取记忆上下文（注入到系统提示词中）
   * 包含全局记忆、长期记忆和最近 3 天的日志摘要
   */
  getMemoryContext(agentId: string): string {
    const globalMemory = this.getGlobalMemory()
    const longTermMemory = this.getMemory(agentId)
    const dates = this.getDailyLogDates(agentId)
    const recentDates = dates.slice(0, 3)

    let recentLogs = ''
    for (const date of recentDates) {
      const log = this.getDailyLog(agentId, date)
      if (log) {
        recentLogs += log + '\n'
      }
    }

    const parts: string[] = ['<memory>']

    if (globalMemory) {
      parts.push(`<global_memory>\n${globalMemory}\n</global_memory>`)
    }

    parts.push(`<long_term>\n${longTermMemory}\n</long_term>`)
    parts.push(`<recent_logs>\n${recentLogs.trimEnd()}\n</recent_logs>`)
    parts.push('</memory>')

    return parts.join('\n')
  }
}
