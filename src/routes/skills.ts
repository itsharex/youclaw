import { Hono } from 'hono'
import type { SkillsLoader } from '../skills/index.ts'
import type { AgentManager } from '../agent/index.ts'

export function createSkillsRoutes(skillsLoader: SkillsLoader, agentManager: AgentManager) {
  const skills = new Hono()

  // GET /api/skills — 所有可用 skills
  skills.get('/skills', (c) => {
    const allSkills = skillsLoader.loadAllSkills()
    return c.json(allSkills)
  })

  // GET /api/agents/:id/skills — agent 启用的 skills
  skills.get('/agents/:id/skills', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const agentSkills = skillsLoader.loadSkillsForAgent(managed.config)
    return c.json(agentSkills)
  })

  return skills
}
