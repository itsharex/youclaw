import { Hono } from 'hono'
import {
  createTask,
  getTasks,
  getTask,
  updateTask,
  deleteTask,
  getTaskRunLogs,
} from '../db/index.ts'
import type { AgentManager } from '../agent/manager.ts'
import type { AgentQueue } from '../agent/queue.ts'
import type { Scheduler } from '../scheduler/scheduler.ts'

export function createTasksRoutes(scheduler: Scheduler, agentManager: AgentManager, agentQueue: AgentQueue) {
  const app = new Hono()

  // GET /api/tasks — 任务列表
  app.get('/tasks', (c) => {
    const tasks = getTasks()
    return c.json(tasks)
  })

  // POST /api/tasks — 创建任务
  app.post('/tasks', async (c) => {
    const body = await c.req.json<{
      agentId: string
      chatId: string
      prompt: string
      scheduleType: string
      scheduleValue: string
    }>()

    // 验证 agent 存在
    const agent = agentManager.getAgent(body.agentId)
    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    // 验证调度类型
    if (!['cron', 'interval', 'once'].includes(body.scheduleType)) {
      return c.json({ error: 'Invalid schedule type. Must be cron, interval, or once' }, 400)
    }

    const id = crypto.randomUUID()

    // 计算首次运行时间
    let nextRun: string
    if (body.scheduleType === 'once') {
      nextRun = body.scheduleValue // ISO 时间
    } else {
      const computed = scheduler.calculateNextRun({
        schedule_type: body.scheduleType,
        schedule_value: body.scheduleValue,
        last_run: null,
      })
      if (!computed) {
        return c.json({ error: 'Invalid schedule value' }, 400)
      }
      nextRun = computed
    }

    createTask({
      id,
      agentId: body.agentId,
      chatId: body.chatId,
      prompt: body.prompt,
      scheduleType: body.scheduleType,
      scheduleValue: body.scheduleValue,
      nextRun,
    })

    const task = getTask(id)
    return c.json(task, 201)
  })

  // PUT /api/tasks/:id — 更新任务
  app.put('/tasks/:id', async (c) => {
    const id = c.req.param('id')
    const existing = getTask(id)
    if (!existing) {
      return c.json({ error: 'Task not found' }, 404)
    }

    const body = await c.req.json<Partial<{
      prompt: string
      scheduleValue: string
      status: string
    }>>()

    const updates: Parameters<typeof updateTask>[1] = {}
    if (body.prompt !== undefined) updates.prompt = body.prompt
    if (body.status !== undefined) updates.status = body.status
    if (body.scheduleValue !== undefined) {
      updates.scheduleValue = body.scheduleValue
      // 重新计算 nextRun
      const nextRun = scheduler.calculateNextRun({
        schedule_type: existing.schedule_type,
        schedule_value: body.scheduleValue,
        last_run: existing.last_run,
      })
      updates.nextRun = nextRun
    }

    updateTask(id, updates)
    const updated = getTask(id)
    return c.json(updated)
  })

  // DELETE /api/tasks/:id — 删除任务
  app.delete('/tasks/:id', (c) => {
    const id = c.req.param('id')
    const existing = getTask(id)
    if (!existing) {
      return c.json({ error: 'Task not found' }, 404)
    }

    deleteTask(id)
    return c.json({ ok: true })
  })

  // POST /api/tasks/:id/run — 手动立即执行
  app.post('/tasks/:id/run', async (c) => {
    const id = c.req.param('id')
    const task = getTask(id)
    if (!task) {
      return c.json({ error: 'Task not found' }, 404)
    }

    try {
      const result = await agentQueue.enqueue(task.agent_id, task.chat_id, task.prompt)
      return c.json({ status: 'success', result })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return c.json({ status: 'error', error }, 500)
    }
  })

  // GET /api/tasks/:id/logs — 运行历史
  app.get('/tasks/:id/logs', (c) => {
    const id = c.req.param('id')
    const existing = getTask(id)
    if (!existing) {
      return c.json({ error: 'Task not found' }, 404)
    }

    const logs = getTaskRunLogs(id)
    return c.json(logs)
  })

  return app
}
