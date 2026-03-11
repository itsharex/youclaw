import { describe, test, expect } from 'bun:test'
import { SkillsInstaller } from '../src/skills/installer.ts'
import type { Skill } from '../src/skills/types.ts'

function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'test-skill',
    source: 'builtin',
    frontmatter: {
      name: 'test-skill',
      description: 'Test skill',
      ...overrides.frontmatter,
    },
    content: 'body',
    path: '/tmp/test-skill/SKILL.md',
    eligible: true,
    eligibilityErrors: [],
    eligibilityDetail: {
      os: { passed: true, current: process.platform },
      dependencies: { passed: true, results: [] },
      env: { passed: true, results: [] },
    },
    loadedAt: Date.now(),
    ...overrides,
  }
}

describe('SkillsInstaller.checkCompatibility', () => {
  const installer = new SkillsInstaller()

  test('无依赖无冲突时通过', () => {
    const skill = createSkill()
    const installed = [createSkill({ name: 'other-skill', frontmatter: { name: 'other-skill', description: 'Other' } })]

    const result = installer.checkCompatibility(skill, installed)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  test('requires 依赖已安装时通过', () => {
    const skill = createSkill({
      frontmatter: { name: 'test-skill', description: 'Test', requires: ['dep-a', 'dep-b'] },
    })
    const installed = [
      createSkill({ name: 'dep-a', frontmatter: { name: 'dep-a', description: 'Dep A' } }),
      createSkill({ name: 'dep-b', frontmatter: { name: 'dep-b', description: 'Dep B' } }),
    ]

    const result = installer.checkCompatibility(skill, installed)
    expect(result.ok).toBe(true)
  })

  test('requires 依赖缺失时报错', () => {
    const skill = createSkill({
      frontmatter: { name: 'test-skill', description: 'Test', requires: ['dep-a', 'dep-missing'] },
    })
    const installed = [
      createSkill({ name: 'dep-a', frontmatter: { name: 'dep-a', description: 'Dep A' } }),
    ]

    const result = installer.checkCompatibility(skill, installed)
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBe(1)
    expect(result.issues[0]).toContain('dep-missing')
  })

  test('conflicts 冲突检测', () => {
    const skill = createSkill({
      frontmatter: { name: 'test-skill', description: 'Test', conflicts: ['conflicting-skill'] },
    })
    const installed = [
      createSkill({ name: 'conflicting-skill', frontmatter: { name: 'conflicting-skill', description: 'Conflict' } }),
    ]

    const result = installer.checkCompatibility(skill, installed)
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBe(1)
    expect(result.issues[0]).toContain('conflicting-skill')
    expect(result.issues[0]).toContain('冲突')
  })

  test('无已安装 skill 时，有依赖的 skill 报错', () => {
    const skill = createSkill({
      frontmatter: { name: 'test-skill', description: 'Test', requires: ['needed'] },
    })

    const result = installer.checkCompatibility(skill, [])
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toContain('needed')
  })

  test('无已安装 skill 时，有冲突声明的 skill 通过', () => {
    const skill = createSkill({
      frontmatter: { name: 'test-skill', description: 'Test', conflicts: ['absent-conflict'] },
    })

    const result = installer.checkCompatibility(skill, [])
    expect(result.ok).toBe(true)
  })

  test('同时有依赖和冲突问题时报告所有问题', () => {
    const skill = createSkill({
      frontmatter: {
        name: 'test-skill',
        description: 'Test',
        requires: ['missing-dep'],
        conflicts: ['existing-conflict'],
      },
    })
    const installed = [
      createSkill({ name: 'existing-conflict', frontmatter: { name: 'existing-conflict', description: 'Conflict' } }),
    ]

    const result = installer.checkCompatibility(skill, installed)
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBe(2)
    expect(result.issues.some((i) => i.includes('missing-dep'))).toBe(true)
    expect(result.issues.some((i) => i.includes('existing-conflict'))).toBe(true)
  })
})

// SkillsLoader.getAgentSkillsView 测试
import './setup-light.ts'
import { SkillsLoader } from '../src/skills/loader.ts'

describe('SkillsLoader.getAgentSkillsView', () => {
  test('无 skills 字段时返回所有可用 skills', () => {
    const loader = new SkillsLoader()
    // loadAllSkills 返回的都是 available
    const allSkills = loader.loadAllSkills()

    const view = loader.getAgentSkillsView({
      id: 'test',
      name: 'Test',
      model: 'claude-sonnet-4-6',
      workspaceDir: '/tmp',
    } as any)

    // available 和 enabled 都应该是全量
    expect(view.available).toEqual(allSkills)
    expect(view.enabled).toEqual(allSkills)
    // eligible 是 enabled 中 eligible=true 的
    for (const s of view.eligible) {
      expect(s.eligible).toBe(true)
    }
  })

  test('有 skills 字段时 enabled 只包含指定的', () => {
    const loader = new SkillsLoader()
    const allSkills = loader.loadAllSkills()
    // 如果没有任何 skill 被加载，这个测试意义不大
    // 但至少验证逻辑不报错
    const view = loader.getAgentSkillsView({
      id: 'test',
      name: 'Test',
      model: 'claude-sonnet-4-6',
      workspaceDir: '/tmp',
      skills: ['nonexistent-skill'],
    } as any)

    expect(view.available).toEqual(allSkills)
    expect(view.enabled).toEqual([]) // nonexistent 匹配不到
    expect(view.eligible).toEqual([])
  })
})
