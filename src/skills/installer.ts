import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { execSync } from 'node:child_process'
import { getLogger } from '../logger/index.ts'
import type { Skill } from './types.ts'

/**
 * SkillsInstaller：管理 skill 的安装和卸载
 *
 * 支持：
 * - 从本地路径复制 skill
 * - 从远程 URL 下载 skill
 * - 卸载 skill（删除目录 + 执行 teardown）
 * - 依赖和冲突检查
 */
export class SkillsInstaller {
  /**
   * 从本地路径安装 skill 到目标目录
   */
  async installFromLocal(sourcePath: string, targetDir: string): Promise<void> {
    const logger = getLogger()

    if (!existsSync(sourcePath)) {
      throw new Error(`源路径不存在: ${sourcePath}`)
    }

    const skillName = basename(sourcePath)
    const destPath = resolve(targetDir, skillName)

    if (existsSync(destPath)) {
      throw new Error(`Skill "${skillName}" 已存在于目标目录`)
    }

    // 创建目标目录
    mkdirSync(destPath, { recursive: true })

    // 复制文件
    try {
      execSync(`cp -r "${sourcePath}/"* "${destPath}/"`, { encoding: 'utf-8', timeout: 30_000 })
    } catch (err) {
      // 清理失败的安装
      rmSync(destPath, { recursive: true, force: true })
      throw new Error(`复制 skill 文件失败: ${err instanceof Error ? err.message : String(err)}`)
    }

    logger.info({ skillName, sourcePath, destPath }, 'Skill 从本地安装完成')
  }

  /**
   * 从远程 URL 安装 skill
   */
  async installFromUrl(url: string, targetDir: string): Promise<void> {
    const logger = getLogger()

    // 创建临时目录下载
    const tmpDir = resolve(targetDir, `.tmp-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })

    try {
      // 使用 curl 下载
      execSync(`curl -sL "${url}" -o "${tmpDir}/SKILL.md"`, { encoding: 'utf-8', timeout: 30_000 })

      // 读取下载的文件，解析 frontmatter 获取名称
      const { parseFrontmatter } = await import('./frontmatter.ts')
      const content = readFileSync(resolve(tmpDir, 'SKILL.md'), 'utf-8')
      const { frontmatter } = parseFrontmatter(content)
      const skillName = frontmatter.name

      const destPath = resolve(targetDir, skillName)
      if (existsSync(destPath)) {
        throw new Error(`Skill "${skillName}" 已存在于目标目录`)
      }

      // 移动到最终位置
      mkdirSync(destPath, { recursive: true })
      execSync(`mv "${tmpDir}/SKILL.md" "${destPath}/SKILL.md"`, { encoding: 'utf-8' })

      logger.info({ skillName, url, destPath }, 'Skill 从远程 URL 安装完成')
    } finally {
      // 清理临时目录
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  /**
   * 卸载 skill
   */
  async uninstall(skillName: string, targetDir: string): Promise<void> {
    const logger = getLogger()
    const skillDir = resolve(targetDir, skillName)

    if (!existsSync(skillDir)) {
      throw new Error(`Skill "${skillName}" 不存在`)
    }

    // 尝试读取 frontmatter 执行 teardown
    try {
      const skillFile = resolve(skillDir, 'SKILL.md')
      if (existsSync(skillFile)) {
        const { parseFrontmatter } = await import('./frontmatter.ts')
        const content = readFileSync(skillFile, 'utf-8')
        const { frontmatter } = parseFrontmatter(content)

        if (frontmatter.teardown) {
          logger.info({ skillName, teardown: frontmatter.teardown }, '执行 teardown 命令')
          try {
            execSync(frontmatter.teardown, { encoding: 'utf-8', timeout: 30_000 })
          } catch (err) {
            logger.warn({ skillName, error: err instanceof Error ? err.message : String(err) }, 'teardown 命令执行失败')
          }
        }
      }
    } catch {
      // teardown 失败不阻止卸载
    }

    // 删除 skill 目录
    rmSync(skillDir, { recursive: true, force: true })
    logger.info({ skillName }, 'Skill 已卸载')
  }

  /**
   * 检查依赖和冲突
   */
  checkCompatibility(skill: Skill, installedSkills: Skill[]): { ok: boolean; issues: string[] } {
    const issues: string[] = []
    const installedNames = new Set(installedSkills.map((s) => s.name))

    // 检查依赖
    if (skill.frontmatter.requires) {
      for (const dep of skill.frontmatter.requires) {
        if (!installedNames.has(dep)) {
          issues.push(`缺少依赖 skill: ${dep}`)
        }
      }
    }

    // 检查冲突
    if (skill.frontmatter.conflicts) {
      for (const conflict of skill.frontmatter.conflicts) {
        if (installedNames.has(conflict)) {
          issues.push(`与已安装的 skill "${conflict}" 冲突`)
        }
      }
    }

    return { ok: issues.length === 0, issues }
  }
}
