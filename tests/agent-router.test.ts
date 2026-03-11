import { describe, test, expect, beforeEach } from 'bun:test'
import './setup-light.ts'
import { AgentRouter } from '../src/agent/router.ts'
import type { AgentInstance } from '../src/agent/types.ts'
import type { Binding } from '../src/agent/schema.ts'

function createAgent(
  id: string,
  bindings?: Binding[],
  overrides: Partial<AgentInstance['config']> = {},
): AgentInstance {
  return {
    config: {
      id,
      name: `Agent ${id}`,
      model: 'claude-sonnet-4-6',
      workspaceDir: `/tmp/${id}`,
      bindings,
      ...overrides,
    } as any,
    workspaceDir: `/tmp/${id}`,
    runtime: {} as any,
    state: {
      sessionId: null,
      isProcessing: false,
      lastProcessedAt: null,
      totalProcessed: 0,
      lastError: null,
      queueDepth: 0,
    },
  }
}

function buildAgentsMap(...agents: AgentInstance[]): Map<string, AgentInstance> {
  const map = new Map<string, AgentInstance>()
  for (const agent of agents) {
    map.set(agent.config.id, agent)
  }
  return map
}

describe('AgentRouter', () => {
  let router: AgentRouter

  beforeEach(() => {
    router = new AgentRouter()
  })

  test('无 bindings 时 fallback 到 default agent', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('other'),
    )
    router.buildRouteTable(agents)

    const result = router.resolve({ channel: 'web', chatId: 'web:abc' })
    expect(result?.config.id).toBe('default')
  })

  test('无 default agent 时 fallback 到第一个 agent', () => {
    const agents = buildAgentsMap(
      createAgent('custom-1'),
    )
    router.buildRouteTable(agents)

    const result = router.resolve({ channel: 'web', chatId: 'web:abc' })
    expect(result?.config.id).toBe('custom-1')
  })

  test('无任何 agent 时返回 undefined', () => {
    router.buildRouteTable(new Map())
    const result = router.resolve({ channel: 'web', chatId: 'web:abc' })
    expect(result).toBeUndefined()
  })

  test('chatIds 精确匹配', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('support', [
        { channel: 'telegram', chatIds: ['tg:111', 'tg:222'], priority: 100 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'telegram', chatId: 'tg:222' })?.config.id).toBe('support')
    // 不匹配的 chatId fallback 到 default
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:999' })?.config.id).toBe('default')
  })

  test('chatIds 不匹配时不会 fallback 到同 binding 的其他条件', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('specific', [
        { channel: 'telegram', chatIds: ['tg:111'], priority: 100 },
      ]),
    )
    router.buildRouteTable(agents)

    // tg:222 不在 chatIds 中，应该 fallback 到 default 而非 specific
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:222' })?.config.id).toBe('default')
  })

  test('channel 渠道匹配', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('web-agent', [
        { channel: 'web', priority: 50 },
      ]),
      createAgent('tg-agent', [
        { channel: 'telegram', priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('web-agent')
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123' })?.config.id).toBe('tg-agent')
  })

  test('channel 不匹配时跳过该 binding', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('web-only', [
        { channel: 'web', priority: 100 },
      ]),
    )
    router.buildRouteTable(agents)

    // telegram 渠道不匹配 web-only 的 binding
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123' })?.config.id).toBe('default')
  })

  test('通配符 channel "*" 匹配所有渠道', () => {
    const agents = buildAgentsMap(
      createAgent('catch-all', [
        { channel: '*', priority: 0 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('catch-all')
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123' })?.config.id).toBe('catch-all')
    expect(router.resolve({ channel: 'api', chatId: 'api:xyz' })?.config.id).toBe('catch-all')
  })

  test('tags 标签匹配', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('support', [
        { channel: 'web', tags: ['support', 'help'], priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    // 匹配 tag
    expect(router.resolve({ channel: 'web', chatId: 'web:abc', tags: ['support'] })?.config.id).toBe('support')
    // 无 tag 不匹配
    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('default')
    // 不同的 tag 不匹配
    expect(router.resolve({ channel: 'web', chatId: 'web:abc', tags: ['billing'] })?.config.id).toBe('default')
  })

  test('condition.isGroup 匹配', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('group-handler', [
        { channel: 'telegram', condition: { isGroup: true }, priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123', isGroup: true })?.config.id).toBe('group-handler')
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123', isGroup: false })?.config.id).toBe('default')
  })

  test('condition.sender 匹配', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('vip', [
        { channel: 'telegram', condition: { sender: 'user-vip' }, priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123', sender: 'user-vip' })?.config.id).toBe('vip')
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123', sender: 'user-normal' })?.config.id).toBe('default')
  })

  test('condition.trigger 正则匹配', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('translate', [
        { channel: '*', condition: { trigger: '^(翻译|translate)' }, priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'web', chatId: 'web:abc', content: '翻译这段话' })?.config.id).toBe('translate')
    expect(router.resolve({ channel: 'web', chatId: 'web:abc', content: 'Translate this' })?.config.id).toBe('translate')
    expect(router.resolve({ channel: 'web', chatId: 'web:abc', content: '你好' })?.config.id).toBe('default')
    // 无 content 时不匹配 trigger 条件
    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('default')
  })

  test('priority 数值越高越优先', () => {
    const agents = buildAgentsMap(
      createAgent('low', [
        { channel: 'web', priority: 10 },
      ]),
      createAgent('high', [
        { channel: 'web', priority: 100 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('high')
  })

  test('chatIds 精确匹配 > channel 匹配 > 通配符', () => {
    const agents = buildAgentsMap(
      createAgent('wildcard', [
        { channel: '*', priority: 0 },
      ]),
      createAgent('web-general', [
        { channel: 'web', priority: 50 },
      ]),
      createAgent('web-specific', [
        { channel: 'web', chatIds: ['web:vip'], priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'web', chatId: 'web:vip' })?.config.id).toBe('web-specific')
    expect(router.resolve({ channel: 'web', chatId: 'web:normal' })?.config.id).toBe('web-general')
    expect(router.resolve({ channel: 'api', chatId: 'api:xyz' })?.config.id).toBe('wildcard')
  })

  test('多个 bindings 同一 agent', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('multi', [
        { channel: 'telegram', chatIds: ['tg:111'], priority: 100 },
        { channel: 'web', tags: ['support'], priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'telegram', chatId: 'tg:111' })?.config.id).toBe('multi')
    expect(router.resolve({ channel: 'web', chatId: 'web:abc', tags: ['support'] })?.config.id).toBe('multi')
    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('default')
  })

  test('getRouteTable 返回完整路由表', () => {
    const agents = buildAgentsMap(
      createAgent('a', [
        { channel: 'web', priority: 10 },
      ]),
      createAgent('b', [
        { channel: 'telegram', chatIds: ['tg:123'], priority: 100 },
      ]),
    )
    router.buildRouteTable(agents)

    const table = router.getRouteTable()
    expect(table.length).toBe(2)

    // 按 priority 降序
    expect(table[0]!.agentId).toBe('b')
    expect(table[0]!.binding.priority).toBe(100)
    expect(table[1]!.agentId).toBe('a')
    expect(table[1]!.binding.priority).toBe(10)

    // 包含 agentName
    expect(table[0]!.agentName).toBe('Agent b')
  })

  test('空路由表返回空数组', () => {
    router.buildRouteTable(new Map())
    expect(router.getRouteTable()).toEqual([])
  })
})
