import { parse as parseYaml } from 'yaml'
import type { SkillFrontmatter } from './types.ts'

export interface ParseResult {
  frontmatter: SkillFrontmatter
  content: string
}

/**
 * 解析 SKILL.md 文件内容，提取 YAML frontmatter 和正文
 * frontmatter 以 `---` 分隔
 */
export function parseFrontmatter(raw: string): ParseResult {
  const trimmed = raw.trimStart()

  if (!trimmed.startsWith('---')) {
    throw new Error('SKILL.md 缺少 frontmatter（需以 --- 开头）')
  }

  const endIndex = trimmed.indexOf('---', 3)
  if (endIndex === -1) {
    throw new Error('SKILL.md frontmatter 未闭合（缺少第二个 ---）')
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim()
  const content = trimmed.slice(endIndex + 3).trim()

  const parsed = parseYaml(yamlBlock) as Record<string, unknown>

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('SKILL.md frontmatter 解析结果无效')
  }

  if (typeof parsed.name !== 'string' || !parsed.name) {
    throw new Error('SKILL.md frontmatter 缺少必需字段: name')
  }

  if (typeof parsed.description !== 'string' || !parsed.description) {
    throw new Error('SKILL.md frontmatter 缺少必需字段: description')
  }

  // 解析 install 字段（Record<string, string>）
  let install: Record<string, string> | undefined
  if (parsed.install && typeof parsed.install === 'object' && !Array.isArray(parsed.install)) {
    install = {}
    for (const [key, value] of Object.entries(parsed.install as Record<string, unknown>)) {
      install[key] = String(value)
    }
  }

  const frontmatter: SkillFrontmatter = {
    name: parsed.name,
    description: String(parsed.description),
    version: parsed.version != null ? String(parsed.version) : undefined,
    os: Array.isArray(parsed.os) ? (parsed.os as unknown[]).map(String) : undefined,
    dependencies: Array.isArray(parsed.dependencies) ? (parsed.dependencies as unknown[]).map(String) : undefined,
    env: Array.isArray(parsed.env) ? (parsed.env as unknown[]).map(String) : undefined,
    tools: Array.isArray(parsed.tools) ? (parsed.tools as unknown[]).map(String) : undefined,
    tags: Array.isArray(parsed.tags) ? (parsed.tags as unknown[]).map(String) : undefined,
    globs: Array.isArray(parsed.globs) ? (parsed.globs as unknown[]).map(String) : undefined,
    install,
  }

  return { frontmatter, content }
}
