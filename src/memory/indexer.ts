import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDatabase } from '../db/index.ts'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'

export interface SearchResult {
  agentId: string
  fileType: string
  filePath: string
  snippet: string
  rank: number
}

/**
 * 基于 SQLite FTS5 的记忆全文搜索索引
 */
export class MemoryIndexer {
  /**
   * 初始化 FTS5 虚拟表
   */
  initTable(): void {
    const db = getDatabase()
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        agent_id, file_type, file_path, content, tokenize='unicode61'
      )
    `)
    getLogger().debug('memory_fts 表已初始化')
  }

  /**
   * 全量重建索引（启动时调用）
   */
  rebuildIndex(): void {
    const db = getDatabase()
    const agentsDir = getPaths().agents

    // 清空现有索引
    db.exec('DELETE FROM memory_fts')

    if (!existsSync(agentsDir)) return

    const agentDirs = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    let count = 0
    for (const agentId of agentDirs) {
      count += this.indexAgentMemory(agentId)
    }

    getLogger().info({ count }, '记忆索引全量重建完成')
  }

  /**
   * 索引单个 agent 的所有记忆文件
   */
  private indexAgentMemory(agentId: string): number {
    const agentsDir = getPaths().agents
    const memoryDir = resolve(agentsDir, agentId, 'memory')
    if (!existsSync(memoryDir)) return 0

    let count = 0

    // 索引 MEMORY.md
    const memoryFile = resolve(memoryDir, 'MEMORY.md')
    if (existsSync(memoryFile)) {
      const content = readFileSync(memoryFile, 'utf-8')
      if (content.trim()) {
        this.indexFile(agentId, 'memory', memoryFile, content)
        count++
      }
    }

    // 索引 logs/
    const logsDir = resolve(memoryDir, 'logs')
    if (existsSync(logsDir)) {
      const logFiles = readdirSync(logsDir).filter((f) => f.endsWith('.md'))
      for (const file of logFiles) {
        const filePath = resolve(logsDir, file)
        const content = readFileSync(filePath, 'utf-8')
        if (content.trim()) {
          this.indexFile(agentId, 'log', filePath, content)
          count++
        }
      }
    }

    // 索引 conversations/
    const convDir = resolve(memoryDir, 'conversations')
    if (existsSync(convDir)) {
      const convFiles = readdirSync(convDir).filter((f) => f.endsWith('.md'))
      for (const file of convFiles) {
        const filePath = resolve(convDir, file)
        const content = readFileSync(filePath, 'utf-8')
        if (content.trim()) {
          this.indexFile(agentId, 'conversation', filePath, content)
          count++
        }
      }
    }

    return count
  }

  /**
   * 增量索引单个文件（先删旧记录再插入）
   */
  indexFile(agentId: string, fileType: string, filePath: string, content: string): void {
    const db = getDatabase()
    // 先删除该文件的旧索引
    db.prepare('DELETE FROM memory_fts WHERE file_path = ?').run(filePath)
    // 插入新索引
    db.prepare(
      'INSERT INTO memory_fts (agent_id, file_type, file_path, content) VALUES (?, ?, ?, ?)'
    ).run(agentId, fileType, filePath, content)
  }

  /**
   * 删除文件索引
   */
  removeFile(filePath: string): void {
    const db = getDatabase()
    db.prepare('DELETE FROM memory_fts WHERE file_path = ?').run(filePath)
  }

  /**
   * 全文搜索
   */
  search(queryStr: string, options?: { agentId?: string; fileType?: string; limit?: number }): SearchResult[] {
    const db = getDatabase()
    const limit = options?.limit ?? 20

    // 构建 FTS5 查询：每个词用引号包裹，AND 连接
    const tokens = queryStr.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return []

    const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' AND ')

    let sql = `SELECT agent_id, file_type, file_path, snippet(memory_fts, 3, '>>>', '<<<', '...', 64) as snippet, rank
               FROM memory_fts
               WHERE memory_fts MATCH ?`
    const params: (string | number)[] = [ftsQuery]

    if (options?.agentId) {
      sql += ' AND agent_id = ?'
      params.push(options.agentId)
    }
    if (options?.fileType) {
      sql += ' AND file_type = ?'
      params.push(options.fileType)
    }

    sql += ' ORDER BY rank LIMIT ?'
    params.push(limit)

    try {
      const rows = db.prepare(sql).all(...params) as Array<{
        agent_id: string
        file_type: string
        file_path: string
        snippet: string
        rank: number
      }>

      return rows.map((r) => ({
        agentId: r.agent_id,
        fileType: r.file_type,
        filePath: r.file_path,
        snippet: r.snippet,
        rank: r.rank,
      }))
    } catch (err) {
      getLogger().warn({ query: queryStr, error: err instanceof Error ? err.message : String(err) }, '记忆搜索失败')
      return []
    }
  }
}
