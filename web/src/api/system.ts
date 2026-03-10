import { apiFetch } from './client'

export interface SystemStatus {
  uptime: number
  platform: string
  nodeVersion: string
  agents: { total: number; active: number }
  telegram: { connected: boolean }
  database: { path: string; sizeBytes: number }
  startedAt: string
}

export async function getSystemStatus() {
  return apiFetch<SystemStatus>('/api/status')
}
