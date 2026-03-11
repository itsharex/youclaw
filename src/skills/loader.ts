import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { parseFrontmatter } from './frontmatter.ts'
import { checkEligibility } from './eligibility.ts'
import type { Skill, SkillsConfig, AgentSkillsView } from './types.ts'
import { DEFAULT_SKILLS_CONFIG } from './types.ts'
import type { AgentConfig } from '../agent/types.ts'
import { getSkillSettings, setSkillEnabled as dbSetSkillEnabled } from '../db/index.ts'

export class SkillsLoader {
  private cache: Map<string, Skill> = new Map()
  private lastLoadTime: number = 0
  private config: SkillsConfig

  constructor(config?: Partial<SkillsConfig>) {
    this.config = { ...DEFAULT_SKILLS_CONFIG, ...config }
  }

  /**
   * 加载所有可用 skills，按三级优先级覆盖（同名高优先级覆盖低优先级）
   * 1. Agent 工作空间: agents/<id>/skills/
   * 2. 项目级: skills/
   * 3. 用户级: ~/.youclaw/skills/
   *
   * 支持缓存，传入 forceReload=true 强制重载
   */
  loadAllSkills(forceReload?: boolean): Skill[] {
    // 有缓存且不强制重载时，直接返回缓存
    if (!forceReload && this.cache.size > 0) {
      return Array.from(this.cache.values())
    }

    const logger = getLogger()
    const paths = getPaths()
    const skillMap = new Map<string, Skill>()

    // 3. 用户级（最低优先级，先加载）
    const userSkillsDir = resolve(homedir(), '.youclaw', 'skills')
    this.loadSkillsFromDir(userSkillsDir, 'user', skillMap)

    // 2. 项目级（builtin）
    const projectSkillsDir = paths.skills
    this.loadSkillsFromDir(projectSkillsDir, 'builtin', skillMap)

    // 1. Agent 工作空间级（最高优先级，最后加载覆盖）
    const agentsDir = paths.agents
    if (existsSync(agentsDir)) {
      const agentEntries = readdirSync(agentsDir)
      for (const agentName of agentEntries) {
        const agentDir = resolve(agentsDir, agentName)
        try {
          if (!statSync(agentDir).isDirectory()) continue
        } catch {
          continue
        }
        const agentSkillsDir = resolve(agentDir, 'skills')
        this.loadSkillsFromDir(agentSkillsDir, 'workspace', skillMap)
      }
    }

    // 读取用户启用/停用设置，合并到每个 skill
    const settings = getSkillSettings()
    for (const [name, skill] of skillMap) {
      const setting = settings[name]
      skill.enabled = setting ? setting.enabled : true
      skill.usable = skill.eligible && skill.enabled
    }

    // 更新缓存
    this.cache = skillMap
    this.lastLoadTime = Date.now()

    const skills = Array.from(skillMap.values())
    logger.debug({ count: skills.length }, 'Skills 加载完成')
    return skills
  }

  /**
   * 根据 agent.yaml 的 skills 字段过滤加载的 skills
   * 如果 agent 未指定 skills 字段，返回所有合格 skills
   */
  loadSkillsForAgent(agentConfig: AgentConfig): Skill[] {
    const allSkills = this.loadAllSkills()

    // 如果 agent 未指定 skills，返回所有 skills
    if (!agentConfig.skills || agentConfig.skills.length === 0) {
      return allSkills
    }

    // 只返回 agent 指定的 skills
    return allSkills.filter((skill) => agentConfig.skills!.includes(skill.name))
  }

  /**
   * 设置 skill 的启用/停用状态，并刷新缓存
   */
  setSkillEnabled(name: string, enabled: boolean): Skill | null {
    dbSetSkillEnabled(name, enabled)
    const skills = this.refresh()
    return skills.find((s) => s.name === name) ?? null
  }

  /**
   * 获取特定 agent 的 skills 视图
   */
  getAgentSkillsView(agentConfig: AgentConfig): AgentSkillsView {
    const allSkills = this.loadAllSkills()

    // available: 该 agent 可用的所有 skills
    const available = allSkills

    // enabled: 已启用的（在 agent.yaml skills 列表中）
    const enabled = agentConfig.skills && agentConfig.skills.length > 0
      ? allSkills.filter((s) => agentConfig.skills!.includes(s.name))
      : allSkills

    // eligible: 通过资格检查的
    const eligible = enabled.filter((s) => s.eligible)

    return { available, enabled, eligible }
  }

  /**
   * 清缓存并重载所有 skills
   */
  refresh(): Skill[] {
    this.cache.clear()
    this.lastLoadTime = 0
    return this.loadAllSkills(true)
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { skillCount: number; lastLoadTime: number; cached: boolean } {
    return {
      skillCount: this.cache.size,
      lastLoadTime: this.lastLoadTime,
      cached: this.cache.size > 0,
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): SkillsConfig {
    return { ...this.config }
  }

  /**
   * 对 skills 列表应用优先级感知的 prompt 限制
   * 1. 按优先级分三组：critical / normal / low
   * 2. Critical: 仅截断单个内容，不受数量和总量限制
   * 3. Normal + Low: 先 normal 后 low，依次应用数量限制和总字符限制（减去 critical 占用）
   * 4. 返回顺序：critical → normal → low
   */
  applyPromptLimits(skills: Skill[]): Skill[] {
    const { maxSingleSkillChars, maxSkillCount, maxTotalChars } = this.config

    // 按优先级分组
    const critical: Skill[] = []
    const normal: Skill[] = []
    const low: Skill[] = []

    for (const skill of skills) {
      const priority = skill.frontmatter.priority ?? 'normal'
      if (priority === 'critical') critical.push(skill)
      else if (priority === 'low') low.push(skill)
      else normal.push(skill)
    }

    // Critical: 仅截断单个内容，不受数量和总量限制
    const truncate = (skill: Skill): Skill => {
      if (skill.content.length <= maxSingleSkillChars) return skill
      return {
        ...skill,
        content: skill.content.slice(0, maxSingleSkillChars) + '\n...[内容已截断]',
      }
    }

    const limitedCritical = critical.map(truncate)

    // 计算 critical 占用的配额
    const criticalCount = limitedCritical.length
    const criticalChars = limitedCritical.reduce((sum, s) => sum + s.content.length, 0)

    // Normal + Low: 合并后依次应用限制（减去 critical 占用）
    const rest = [...normal, ...low].map(truncate)
    const remainingCount = Math.max(0, maxSkillCount - criticalCount)
    const remainingChars = Math.max(0, maxTotalChars - criticalChars)

    let totalChars = 0
    const limitedRest: Skill[] = []
    for (const skill of rest) {
      if (limitedRest.length >= remainingCount) break
      totalChars += skill.content.length
      if (totalChars > remainingChars) break
      limitedRest.push(skill)
    }

    return [...limitedCritical, ...limitedRest]
  }

  /**
   * 从指定目录加载 skills
   * 每个子目录下寻找 SKILL.md
   */
  private loadSkillsFromDir(dir: string, source: Skill['source'], skillMap: Map<string, Skill>): void {
    const logger = getLogger()

    if (!existsSync(dir)) return

    let dirEntries: string[]
    try {
      dirEntries = readdirSync(dir)
    } catch {
      logger.debug({ dir }, '无法读取 skills 目录')
      return
    }

    for (const entryName of dirEntries) {
      const skillDir = resolve(dir, entryName)
      try {
        if (!statSync(skillDir).isDirectory()) continue
      } catch {
        continue
      }
      const skillFile = resolve(skillDir, 'SKILL.md')

      if (!existsSync(skillFile)) continue

      try {
        const raw = readFileSync(skillFile, 'utf-8')
        const { frontmatter, content } = parseFrontmatter(raw)
        const { eligible, errors, detail } = checkEligibility(frontmatter)

        const skill: Skill = {
          name: frontmatter.name,
          source,
          frontmatter,
          content,
          path: skillFile,
          eligible,
          eligibilityErrors: errors,
          eligibilityDetail: detail,
          loadedAt: Date.now(),
          enabled: true,  // 默认启用，后续由 settings 覆盖
          usable: eligible,
        }

        // 高优先级覆盖低优先级
        skillMap.set(skill.name, skill)

        logger.debug({ name: skill.name, source, eligible }, 'Skill 已加载')
      } catch (err) {
        logger.warn(
          { skillDir, error: err instanceof Error ? err.message : String(err) },
          '加载 skill 失败',
        )
      }
    }
  }
}
