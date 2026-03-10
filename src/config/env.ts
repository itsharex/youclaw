import { z } from 'zod/v4'

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  DATA_DIR: z.string().default('./data'),
  AGENT_MODEL: z.string().default('claude-sonnet-4-6'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
})

export type EnvConfig = z.infer<typeof envSchema>

let _config: EnvConfig | null = null

export function loadEnv(): EnvConfig {
  if (_config) return _config

  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('环境变量校验失败:')
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`)
    }
    process.exit(1)
  }

  _config = result.data
  return _config
}

export function getEnv(): EnvConfig {
  if (!_config) throw new Error('环境变量未初始化，请先调用 loadEnv()')
  return _config
}
