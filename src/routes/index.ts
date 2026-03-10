import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { health } from './health.ts'
import { createAgentsRoutes } from './agents.ts'
import { createMessagesRoutes } from './messages.ts'
import { createStreamRoutes } from './stream.ts'
import type { AgentManager, AgentQueue } from '../agent/index.ts'
import type { EventBus } from '../events/index.ts'
import type { MessageRouter } from '../channel/index.ts'

export function createApp(agentManager: AgentManager, agentQueue: AgentQueue, eventBus: EventBus, router: MessageRouter) {
  const app = new Hono()

  // CORS — 允许 Vite dev server
  app.use('/*', cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type'],
  }))

  // 挂载路由
  app.route('/api', health)
  app.route('/api', createAgentsRoutes(agentManager))
  app.route('/api', createMessagesRoutes(agentManager, agentQueue, router))
  app.route('/api', createStreamRoutes(eventBus))

  return app
}
