import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import './setup-light.ts'
import { SecretsManager } from '../src/agent/secrets.ts'
import { createSecurityHook } from '../src/agent/security.ts'
import type { HookContext } from '../src/agent/hooks.ts'
import type { SecurityConfig } from '../src/agent/schema.ts'

// === SecretsManager 测试 ===

describe('SecretsManager', () => {
  let secrets: SecretsManager
  const savedEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }

  beforeEach(() => {
    secrets = new SecretsManager()
  })

  afterEach(() => {
    // 还原环境变量
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    Object.keys(savedEnv).forEach((k) => delete savedEnv[k])
  })

  test('loadFromEnv 正确解析 YOUCLAW_SECRET_<AGENTID>_<KEY>', () => {
    setEnv('YOUCLAW_SECRET_MYAGENT_API_TOKEN', 'sk-test-123')
    setEnv('YOUCLAW_SECRET_MYAGENT_DB_PASSWORD', 'pass-456')
    setEnv('YOUCLAW_SECRET_OTHER_KEY', 'other-val')

    secrets.loadFromEnv()

    expect(secrets.getSecretKeys('myagent')).toContain('api_token')
    expect(secrets.getSecretKeys('myagent')).toContain('db_password')
    expect(secrets.getSecretKeys('other')).toContain('key')
  })

  test('resolve 替换 ${SECRET:key} 引用', () => {
    setEnv('YOUCLAW_SECRET_AGENT1_TOKEN', 'my-secret-token')
    secrets.loadFromEnv()

    const result = secrets.resolve('agent1', 'Bearer ${SECRET:token}')
    expect(result).toBe('Bearer my-secret-token')
  })

  test('resolve 不存在的 secret 返回空字符串', () => {
    setEnv('YOUCLAW_SECRET_AGENT1_EXISTING', 'value')
    secrets.loadFromEnv()
    // agent1 有 secrets 映射，但 nonexistent 不在其中 → 替换为空字符串
    const result = secrets.resolve('agent1', '${SECRET:nonexistent}')
    expect(result).toBe('')
  })

  test('resolve 不存在的 agent 返回原始模板', () => {
    secrets.loadFromEnv()
    const result = secrets.resolve('nonexistent', 'no change ${SECRET:key}')
    // 没有该 agent 的 secrets，模板原样返回
    expect(result).toBe('no change ${SECRET:key}')
  })

  test('resolve 大小写不敏感（统一转小写）', () => {
    setEnv('YOUCLAW_SECRET_MYAGENT_API_KEY', 'test-key')
    secrets.loadFromEnv()

    expect(secrets.resolve('myagent', '${SECRET:api_key}')).toBe('test-key')
    expect(secrets.resolve('myagent', '${SECRET:API_KEY}')).toBe('test-key')
  })

  test('injectToMcpEnv 替换 MCP 服务器环境变量中的 secrets', () => {
    setEnv('YOUCLAW_SECRET_AGENT1_SERVER_TOKEN', 'injected-token')
    secrets.loadFromEnv()

    const servers = {
      'my-server': {
        command: 'node',
        args: ['server.js'],
        env: {
          TOKEN: '${SECRET:server_token}',
          NORMAL: '${SOME_VAR}',
        },
      },
    }

    const result = secrets.injectToMcpEnv('agent1', servers)

    expect(result['my-server']!.env!.TOKEN).toBe('injected-token')
    // 非 SECRET 引用保持不变
    expect(result['my-server']!.env!.NORMAL).toBe('${SOME_VAR}')
  })

  test('injectToMcpEnv 无 secrets 时返回原始配置', () => {
    secrets.loadFromEnv()
    const servers = {
      'my-server': { command: 'node', env: { KEY: 'val' } },
    }
    const result = secrets.injectToMcpEnv('agent1', servers)
    expect(result).toEqual(servers)
  })

  test('injectToMcpEnv 无 env 的 server 直接透传', () => {
    setEnv('YOUCLAW_SECRET_AGENT1_KEY', 'val')
    secrets.loadFromEnv()

    const servers = {
      'no-env': { command: 'node' },
    }
    const result = secrets.injectToMcpEnv('agent1', servers)
    expect(result['no-env']).toEqual({ command: 'node' })
  })

  test('getSecretKeys 不暴露值', () => {
    setEnv('YOUCLAW_SECRET_SAFE_TOKEN', 'sensitive-value')
    secrets.loadFromEnv()

    const keys = secrets.getSecretKeys('safe')
    expect(keys).toEqual(['token'])
    // keys 中不包含实际值
    expect(keys.join('')).not.toContain('sensitive-value')
  })

  test('无效命名格式被忽略', () => {
    setEnv('YOUCLAW_SECRET_NOKEY', 'bad-format')
    secrets.loadFromEnv()

    // NOKEY 没有下划线分隔 agentId 和 key，应被忽略
    expect(secrets.getSecretKeys('nokey')).toEqual([])
  })
})

// === Security Hook 测试 ===

function createHookContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    agentId: 'test-agent',
    chatId: 'web:chat-1',
    phase: 'pre_tool_use',
    payload: { tool: 'Read', input: {} },
    ...overrides,
  }
}

describe('createSecurityHook', () => {
  test('工具白名单：允许列表内的工具', async () => {
    const hook = createSecurityHook({ allowedTools: ['Read', 'Grep'] })

    const readCtx = createHookContext({ payload: { tool: 'Read', input: {} } })
    const readResult = await hook(readCtx)
    expect(readResult.abort).toBeUndefined()
  })

  test('工具白名单：拦截列表外的工具', async () => {
    const hook = createSecurityHook({ allowedTools: ['Read', 'Grep'] })

    const bashCtx = createHookContext({ payload: { tool: 'Bash', input: {} } })
    const bashResult = await hook(bashCtx)
    expect(bashResult.abort).toBe(true)
    expect(bashResult.abortReason).toContain('Bash')
    expect(bashResult.abortReason).toContain('不在允许列表')
  })

  test('工具黑名单：拦截列表内的工具', async () => {
    const hook = createSecurityHook({ disallowedTools: ['Bash', 'Write'] })

    const bashCtx = createHookContext({ payload: { tool: 'Bash', input: {} } })
    const bashResult = await hook(bashCtx)
    expect(bashResult.abort).toBe(true)
    expect(bashResult.abortReason).toContain('被禁止')

    const readCtx = createHookContext({ payload: { tool: 'Read', input: {} } })
    const readResult = await hook(readCtx)
    expect(readResult.abort).toBeUndefined()
  })

  test('文件路径：deniedPaths 拦截', async () => {
    const hook = createSecurityHook({
      fileAccess: {
        deniedPaths: ['/etc/', '/root/'],
      },
    })

    const deniedCtx = createHookContext({
      payload: { tool: 'Read', input: { file_path: '/etc/passwd' } },
    })
    const deniedResult = await hook(deniedCtx)
    expect(deniedResult.abort).toBe(true)
    expect(deniedResult.abortReason).toContain('禁止访问')
  })

  test('文件路径：allowedPaths 限制', async () => {
    const hook = createSecurityHook({
      fileAccess: {
        allowedPaths: ['/tmp/safe/', '/home/user/projects/'],
      },
    })

    const allowedCtx = createHookContext({
      payload: { tool: 'Read', input: { file_path: '/tmp/safe/file.txt' } },
    })
    const allowedResult = await hook(allowedCtx)
    expect(allowedResult.abort).toBeUndefined()

    const deniedCtx = createHookContext({
      payload: { tool: 'Read', input: { file_path: '/var/log/syslog' } },
    })
    const deniedResult = await hook(deniedCtx)
    expect(deniedResult.abort).toBe(true)
    expect(deniedResult.abortReason).toContain('不在允许访问列表')
  })

  test('非文件工具不检查路径', async () => {
    const hook = createSecurityHook({
      fileAccess: {
        allowedPaths: ['/tmp/'],
      },
    })

    // WebSearch 不是文件操作工具，不检查路径
    const ctx = createHookContext({
      payload: { tool: 'WebSearch', input: { query: 'test' } },
    })
    const result = await hook(ctx)
    expect(result.abort).toBeUndefined()
  })

  test('无安全配置时全部放行', async () => {
    const hook = createSecurityHook({})

    const ctx = createHookContext({ payload: { tool: 'Bash', input: { command: 'rm -rf /' } } })
    const result = await hook(ctx)
    expect(result.abort).toBeUndefined()
  })

  test('Edit 工具的文件路径提取', async () => {
    const hook = createSecurityHook({
      fileAccess: { deniedPaths: ['/etc/'] },
    })

    const ctx = createHookContext({
      payload: { tool: 'Edit', input: { file_path: '/etc/hosts', old_string: 'a', new_string: 'b' } },
    })
    const result = await hook(ctx)
    expect(result.abort).toBe(true)
  })

  test('Glob 工具的 path 提取', async () => {
    const hook = createSecurityHook({
      fileAccess: { deniedPaths: ['/etc/'] },
    })

    const ctx = createHookContext({
      payload: { tool: 'Glob', input: { path: '/etc/nginx/', pattern: '*.conf' } },
    })
    const result = await hook(ctx)
    expect(result.abort).toBe(true)
  })

  test('白名单和黑名单同时配置，白名单优先检查', async () => {
    const hook = createSecurityHook({
      allowedTools: ['Read'],
      disallowedTools: ['Read'], // 矛盾配置
    })

    // allowedTools 先检查 → Read 在白名单中 → 通过白名单
    // 然后检查黑名单 → Read 在黑名单中 → 被拦截
    const ctx = createHookContext({ payload: { tool: 'Read', input: {} } })
    const result = await hook(ctx)
    // Read 在白名单中通过，但也在黑名单中被拦截
    expect(result.abort).toBe(true)
  })
})
