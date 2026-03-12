import { Hono } from 'hono'
import { z } from 'zod/v4'
import { getLogger } from '../logger/index.ts'
import { CHANNEL_TYPE_REGISTRY, maskSecretFields } from '../channel/config-schema.ts'
import type { ChannelManager } from '../channel/manager.ts'
import { getChannelRecords, getChannelRecord } from '../db/index.ts'

const createChannelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).optional(),
  type: z.string().min(1),
  label: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
})

const updateChannelSchema = z.object({
  label: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
})

export function createChannelsRoutes(channelManager: ChannelManager) {
  const channels = new Hono()

  // GET /api/channels — 列出所有 channel 实例（含运行时状态）
  channels.get('/channels', (c) => {
    const statuses = channelManager.getStatuses()
    const records = getChannelRecords()

    const result = records.map((record) => {
      const status = statuses.find((s) => s.id === record.id)
      const config = JSON.parse(record.config) as Record<string, unknown>
      const { masked, configuredFields } = maskSecretFields(record.type, config)
      const typeInfo = CHANNEL_TYPE_REGISTRY[record.type]

      return {
        id: record.id,
        type: record.type,
        label: record.label,
        chatIdPrefix: typeInfo?.chatIdPrefix ?? '',
        docsUrl: typeInfo?.docsUrl ?? '',
        connected: status?.connected ?? false,
        enabled: !!record.enabled,
        config: masked,
        configuredFields,
        error: status?.error,
        created_at: record.created_at,
        updated_at: record.updated_at,
      }
    })

    return c.json(result)
  })

  // GET /api/channels/types — 列出支持的 channel 类型（元信息）
  channels.get('/channels/types', (c) => {
    const types = Object.values(CHANNEL_TYPE_REGISTRY).map((info) => ({
      type: info.type,
      label: info.label,
      description: info.description,
      chatIdPrefix: info.chatIdPrefix,
      configFields: info.configFields,
      docsUrl: info.docsUrl,
    }))
    return c.json(types)
  })

  // POST /api/channels — 创建 channel 实例
  channels.post('/channels', async (c) => {
    const body = await c.req.json()
    const parsed = createChannelSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: '参数校验失败', details: parsed.error.issues }, 400)
    }

    try {
      const record = await channelManager.createChannel(parsed.data)
      return c.json(record, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 400)
    }
  })

  // PUT /api/channels/:id — 更新配置（触发热重连）
  channels.put('/channels/:id', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    const parsed = updateChannelSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: '参数校验失败', details: parsed.error.issues }, 400)
    }

    try {
      const record = await channelManager.updateChannel(id, parsed.data)
      return c.json(record)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const status = msg.includes('不存在') ? 404 : 400
      return c.json({ error: msg }, status)
    }
  })

  // DELETE /api/channels/:id — 删除（先断开）
  channels.delete('/channels/:id', async (c) => {
    const id = c.req.param('id')

    if (!getChannelRecord(id)) {
      return c.json({ error: `Channel "${id}" 不存在` }, 404)
    }

    try {
      await channelManager.deleteChannel(id)
      return c.json({ ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 500)
    }
  })

  // POST /api/channels/:id/connect — 手动连接
  channels.post('/channels/:id/connect', async (c) => {
    const id = c.req.param('id')
    try {
      await channelManager.connectChannel(id)
      return c.json({ ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 400)
    }
  })

  // POST /api/channels/:id/disconnect — 手动断开
  channels.post('/channels/:id/disconnect', async (c) => {
    const id = c.req.param('id')
    try {
      await channelManager.disconnectChannel(id)
      return c.json({ ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 400)
    }
  })

  return channels
}
