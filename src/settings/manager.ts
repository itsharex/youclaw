import { getDatabase } from '../db/index.ts'
import { getEnv } from '../config/index.ts'
import { SettingsSchema, type Settings, type CustomModel } from './schema.ts'

// kv_state 中的 key
const SETTINGS_KEY = 'settings'

/**
 * 从 kv_state 读取 settings，缺失则返回默认值
 */
export function getSettings(): Settings {
  const db = getDatabase()
  const row = db.query("SELECT value FROM kv_state WHERE key = ?").get(SETTINGS_KEY) as { value: string } | null
  if (!row) {
    return SettingsSchema.parse({})
  }
  try {
    return SettingsSchema.parse(JSON.parse(row.value))
  } catch {
    return SettingsSchema.parse({})
  }
}

/**
 * 局部更新 settings，深合并后整体写回
 */
export function updateSettings(partial: Partial<Settings>): Settings {
  const db = getDatabase()
  const current = getSettings()

  // 深合并
  const merged: Settings = {
    activeModel: partial.activeModel ?? current.activeModel,
    customModels: partial.customModels ?? current.customModels,
  }

  // 校验后写入
  const validated = SettingsSchema.parse(merged)
  db.run(
    "INSERT OR REPLACE INTO kv_state (key, value) VALUES (?, ?)",
    [SETTINGS_KEY, JSON.stringify(validated)]
  )
  return validated
}

/**
 * 返回当前激活模型的完整配置，供 runtime 使用
 * 返回 null 表示使用环境变量 fallback
 */
export function getActiveModelConfig(): { apiKey: string; baseUrl: string; modelId: string; provider: string } | null {
  const settings = getSettings()

  if (settings.activeModel.provider === 'builtin' || settings.activeModel.provider === 'cloud') {
    const env = getEnv()
    const builtinUrl = env.YOUCLAW_BUILTIN_API_URL
    const builtinToken = env.YOUCLAW_BUILTIN_AUTH_TOKEN
    if (builtinUrl && builtinToken) {
      return {
        apiKey: builtinToken,
        baseUrl: builtinUrl,
        modelId: 'claude-sonnet-4-6',
        provider: 'builtin',
      }
    }
    // 未配置内置模型参数，fallback 到环境变量
    return null
  }

  if (settings.activeModel.provider === 'custom' && settings.activeModel.id) {
    const model = settings.customModels.find((m: CustomModel) => m.id === settings.activeModel.id)
    if (model) {
      return {
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
        modelId: model.modelId,
        provider: model.provider,
      }
    }
  }

  // 未找到自定义模型，返回 null 让调用方 fallback 到环境变量
  return null
}
