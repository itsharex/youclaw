import { Hono } from 'hono'
import type { AgentManager } from '../agent/index.ts'

export function createAgentsRoutes(agentManager: AgentManager) {
  const agents = new Hono()

  // GET /api/agents — 列出所有 agents
  agents.get('/agents', (c) => {
    const configs = agentManager.getAgents()
    return c.json(configs)
  })

  // GET /api/agents/:id — 获取单个 agent 详情
  agents.get('/agents/:id', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    return c.json(managed.config)
  })

  return agents
}
