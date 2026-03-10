import type { SkillFrontmatter } from './types.ts'

export interface EligibilityResult {
  eligible: boolean
  errors: string[]
}

/**
 * 检查 skill 是否满足运行条件
 * - OS 是否匹配
 * - 依赖的可执行文件是否存在
 * - 需要的环境变量是否已设置
 */
export function checkEligibility(frontmatter: SkillFrontmatter): EligibilityResult {
  const errors: string[] = []

  // 检查 OS
  if (frontmatter.os && frontmatter.os.length > 0) {
    if (!frontmatter.os.includes(process.platform)) {
      errors.push(`OS 不匹配: 需要 [${frontmatter.os.join(', ')}]，当前为 ${process.platform}`)
    }
  }

  // 检查 dependencies（可执行文件）
  if (frontmatter.dependencies) {
    for (const dep of frontmatter.dependencies) {
      const found = Bun.which(dep)
      if (!found) {
        errors.push(`依赖缺失: 可执行文件 "${dep}" 未找到`)
      }
    }
  }

  // 检查 env（环境变量）
  if (frontmatter.env) {
    for (const envVar of frontmatter.env) {
      if (!process.env[envVar]) {
        errors.push(`环境变量缺失: "${envVar}" 未设置`)
      }
    }
  }

  return {
    eligible: errors.length === 0,
    errors,
  }
}
