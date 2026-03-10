import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { parseFrontmatter } from './frontmatter.ts'
import { checkEligibility } from './eligibility.ts'
import type { Skill } from './types.ts'
import type { AgentConfig } from '../agent/types.ts'

export class SkillsLoader {
  /**
   * 加载所有可用 skills，按三级优先级覆盖（同名高优先级覆盖低优先级）
   * 1. Agent 工作空间: agents/<id>/skills/
   * 2. 项目级: skills/
   * 3. 用户级: ~/.zoerclaw/skills/
   */
  loadAllSkills(): Skill[] {
    const logger = getLogger()
    const paths = getPaths()
    const skillMap = new Map<string, Skill>()

    // 3. 用户级（最低优先级，先加载）
    const userSkillsDir = resolve(homedir(), '.zoerclaw', 'skills')
    this.loadSkillsFromDir(userSkillsDir, 'user', skillMap)

    // 2. 项目级
    const projectSkillsDir = paths.skills
    this.loadSkillsFromDir(projectSkillsDir, 'project', skillMap)

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
        const { eligible, errors } = checkEligibility(frontmatter)

        const skill: Skill = {
          name: frontmatter.name,
          source,
          frontmatter,
          content,
          path: skillFile,
          eligible,
          eligibilityErrors: errors,
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
