import type { AgentRuntime } from './runtime.ts'

export interface AgentConfig {
  id: string
  name: string
  model: string
  workspaceDir: string
  trigger?: string           // 触发模式（正则），如 "@assistant"
  requiresTrigger?: boolean  // 群聊是否需要触发（默认 true）
  telegram?: {
    chatIds?: string[]       // 绑定的 Telegram chat IDs，如 ["tg:123456"]
  }
  memory?: {
    enabled?: boolean
  }
  skills?: string[]
}

export interface AgentState {
  sessionId: string | null
  isProcessing: boolean
}

export interface ProcessParams {
  chatId: string
  prompt: string
  agentId: string
}

export interface ManagedAgent {
  config: AgentConfig
  runtime: AgentRuntime
  state: AgentState
}
