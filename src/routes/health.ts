import { Hono } from 'hono'
import { execSync } from 'node:child_process'
import { which, resetShellEnvCache } from '../utils/shell-env.ts'

const health = new Hono()

health.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// GET /api/git-check — check if git is available
health.get('/git-check', (c) => {
  if (process.platform === 'win32') {
    // Spawn a fresh cmd.exe — it reads the live system PATH from the registry,
    // same mechanism as claude-agent-sdk, so newly installed Git is always found.
    try {
      const output = execSync('cmd.exe /c where git', {
        encoding: 'utf-8',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const gitPath = output.trim().split('\n')[0]?.trim() || null
      return c.json({ available: gitPath !== null, path: gitPath })
    } catch {
      return c.json({ available: false, path: null })
    }
  }

  // Non-Windows: use which (reliable on macOS/Linux)
  resetShellEnvCache()
  const gitPath = which('git')
  return c.json({ available: gitPath !== null, path: gitPath })
})

export { health }
