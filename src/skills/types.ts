export interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  os?: string[]           // 支持的操作系统，如 ["darwin", "linux"]
  dependencies?: string[] // 需要的可执行文件，如 ["chrome", "node"]
  env?: string[]          // 需要的环境变量，如 ["MINIMAX_API_KEY"]
  tools?: string[]        // 提供的工具
}

export interface Skill {
  name: string
  source: 'workspace' | 'project' | 'user' // 来源层级
  frontmatter: SkillFrontmatter
  content: string          // SKILL.md 内容（去掉 frontmatter 后的部分）
  path: string             // 文件路径
  eligible: boolean        // 资格检查结果
  eligibilityErrors: string[] // 资格检查失败原因
}
