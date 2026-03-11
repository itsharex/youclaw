import { describe, test, expect, beforeEach } from 'bun:test'
import './setup-light.ts'
import { HooksManager, type HookContext, type HookHandler } from '../src/agent/hooks.ts'

function createContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    agentId: 'test-agent',
    chatId: 'web:chat-1',
    phase: 'pre_process',
    payload: {},
    ...overrides,
  }
}

describe('HooksManager', () => {
  let hooks: HooksManager

  beforeEach(() => {
    hooks = new HooksManager()
  })

  test('无 hooks 时直接返回原始 context', async () => {
    const ctx = createContext({ payload: { prompt: 'hello' } })
    const result = await hooks.execute('test-agent', 'pre_process', ctx)
    expect(result.payload.prompt).toBe('hello')
    expect(result.abort).toBeUndefined()
  })

  test('registerBuiltinHook 注册并执行', async () => {
    const handler: HookHandler = async (ctx) => {
      ctx.modifiedPayload = { prompt: 'modified' }
      return ctx
    }

    hooks.registerBuiltinHook('test-agent', 'pre_process', handler)

    const ctx = createContext({ payload: { prompt: 'original' } })
    const result = await hooks.execute('test-agent', 'pre_process', ctx)

    expect(result.modifiedPayload?.prompt).toBe('modified')
  })

  test('abort 中止后续 hooks', async () => {
    const firstHook: HookHandler = async (ctx) => {
      ctx.abort = true
      ctx.abortReason = '被第一个 hook 拦截'
      return ctx
    }

    const secondHook: HookHandler = async (ctx) => {
      ctx.modifiedPayload = { reached: true }
      return ctx
    }

    hooks.registerBuiltinHook('test-agent', 'pre_process', firstHook, 0)
    hooks.registerBuiltinHook('test-agent', 'pre_process', secondHook, 10)

    const ctx = createContext()
    const result = await hooks.execute('test-agent', 'pre_process', ctx)

    expect(result.abort).toBe(true)
    expect(result.abortReason).toBe('被第一个 hook 拦截')
    expect(result.modifiedPayload?.reached).toBeUndefined()
  })

  test('priority 排序：数值越小越先执行', async () => {
    const order: number[] = []

    const hookA: HookHandler = async (ctx) => {
      order.push(1)
      return ctx
    }
    const hookB: HookHandler = async (ctx) => {
      order.push(2)
      return ctx
    }
    const hookC: HookHandler = async (ctx) => {
      order.push(3)
      return ctx
    }

    hooks.registerBuiltinHook('test-agent', 'pre_process', hookC, 100)
    hooks.registerBuiltinHook('test-agent', 'pre_process', hookA, -10)
    hooks.registerBuiltinHook('test-agent', 'pre_process', hookB, 50)

    await hooks.execute('test-agent', 'pre_process', createContext())

    expect(order).toEqual([1, 2, 3])
  })

  test('hook 错误不影响主流程（跳过并继续）', async () => {
    const errorHook: HookHandler = async () => {
      throw new Error('Hook 内部错误')
    }

    const normalHook: HookHandler = async (ctx) => {
      ctx.modifiedPayload = { reached: true }
      return ctx
    }

    hooks.registerBuiltinHook('test-agent', 'pre_process', errorHook, 0)
    hooks.registerBuiltinHook('test-agent', 'pre_process', normalHook, 10)

    const result = await hooks.execute('test-agent', 'pre_process', createContext())

    // 错误的 hook 被跳过，后续 hook 正常执行
    expect(result.modifiedPayload?.reached).toBe(true)
  })

  test('hook 超时被跳过', async () => {
    const slowHook: HookHandler = async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 10_000))
      return ctx
    }

    const normalHook: HookHandler = async (ctx) => {
      ctx.modifiedPayload = { afterTimeout: true }
      return ctx
    }

    hooks.registerBuiltinHook('test-agent', 'pre_process', slowHook, 0)
    hooks.registerBuiltinHook('test-agent', 'pre_process', normalHook, 10)

    const result = await hooks.execute('test-agent', 'pre_process', createContext())

    // 超时 hook 被跳过，后续 hook 正常执行
    expect(result.modifiedPayload?.afterTimeout).toBe(true)
  }, 10_000) // 测试本身给足时间

  test('pre_tool_use 的 tools 过滤', async () => {
    const called: string[] = []

    const bashGuard: HookHandler = async (ctx) => {
      called.push('bash-guard')
      ctx.abort = true
      ctx.abortReason = 'Bash 被禁止'
      return ctx
    }

    // 注册一个只对 Bash 工具生效的 hook
    hooks.registerBuiltinHook('test-agent', 'pre_tool_use', bashGuard, 0)

    // 手动设置 tools 过滤
    const agentHooks = (hooks as any).hooks.get('test-agent')!.get('pre_tool_use')!
    agentHooks[0].tools = ['Bash']

    // Bash 工具 → 应该被拦截
    const bashCtx = createContext({
      phase: 'pre_tool_use',
      payload: { tool: 'Bash', input: 'rm -rf /' },
    })
    const bashResult = await hooks.execute('test-agent', 'pre_tool_use', bashCtx)
    expect(bashResult.abort).toBe(true)
    expect(called).toContain('bash-guard')

    // Read 工具 → 应该跳过 bashGuard
    called.length = 0
    const readCtx = createContext({
      phase: 'pre_tool_use',
      payload: { tool: 'Read', input: '/tmp/test' },
    })
    const readResult = await hooks.execute('test-agent', 'pre_tool_use', readCtx)
    expect(readResult.abort).toBeUndefined()
    expect(called).not.toContain('bash-guard')
  })

  test('unloadHooks 清理后不再执行', async () => {
    const handler: HookHandler = async (ctx) => {
      ctx.modifiedPayload = { executed: true }
      return ctx
    }

    hooks.registerBuiltinHook('test-agent', 'pre_process', handler)

    // 卸载前能执行
    let result = await hooks.execute('test-agent', 'pre_process', createContext())
    expect(result.modifiedPayload?.executed).toBe(true)

    // 卸载后不再执行
    hooks.unloadHooks('test-agent')
    result = await hooks.execute('test-agent', 'pre_process', createContext())
    expect(result.modifiedPayload).toBeUndefined()
  })

  test('不同 agent 的 hooks 互相隔离', async () => {
    const handlerA: HookHandler = async (ctx) => {
      ctx.modifiedPayload = { agent: 'A' }
      return ctx
    }
    const handlerB: HookHandler = async (ctx) => {
      ctx.modifiedPayload = { agent: 'B' }
      return ctx
    }

    hooks.registerBuiltinHook('agent-a', 'pre_process', handlerA)
    hooks.registerBuiltinHook('agent-b', 'pre_process', handlerB)

    const resultA = await hooks.execute('agent-a', 'pre_process', createContext({ agentId: 'agent-a' }))
    const resultB = await hooks.execute('agent-b', 'pre_process', createContext({ agentId: 'agent-b' }))

    expect(resultA.modifiedPayload?.agent).toBe('A')
    expect(resultB.modifiedPayload?.agent).toBe('B')
  })

  test('不同 phase 的 hooks 互相隔离', async () => {
    const preHandler: HookHandler = async (ctx) => {
      ctx.modifiedPayload = { phase: 'pre' }
      return ctx
    }
    const postHandler: HookHandler = async (ctx) => {
      ctx.modifiedPayload = { phase: 'post' }
      return ctx
    }

    hooks.registerBuiltinHook('test-agent', 'pre_process', preHandler)
    hooks.registerBuiltinHook('test-agent', 'post_process', postHandler)

    const preResult = await hooks.execute('test-agent', 'pre_process', createContext({ phase: 'pre_process' }))
    const postResult = await hooks.execute('test-agent', 'post_process', createContext({ phase: 'post_process' }))

    expect(preResult.modifiedPayload?.phase).toBe('pre')
    expect(postResult.modifiedPayload?.phase).toBe('post')
  })

  test('hook 链依次传递 context 修改', async () => {
    const hook1: HookHandler = async (ctx) => {
      ctx.payload.step1 = true
      return ctx
    }
    const hook2: HookHandler = async (ctx) => {
      ctx.payload.step2 = true
      // 验证 step1 已存在
      ctx.payload.step1Existed = ctx.payload.step1 === true
      return ctx
    }

    hooks.registerBuiltinHook('test-agent', 'pre_process', hook1, 0)
    hooks.registerBuiltinHook('test-agent', 'pre_process', hook2, 10)

    const result = await hooks.execute('test-agent', 'pre_process', createContext())

    expect(result.payload.step1).toBe(true)
    expect(result.payload.step2).toBe(true)
    expect(result.payload.step1Existed).toBe(true)
  })
})
