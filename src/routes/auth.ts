import { Hono } from 'hono'
import { getDatabase } from '../db/index.ts'
import { getEnv } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'

const AUTH_TOKEN_KEY = 'auth_token'

// 从 kv_state 读取 token
export function getAuthToken(): string | null {
  const db = getDatabase()
  const row = db.query("SELECT value FROM kv_state WHERE key = ?").get(AUTH_TOKEN_KEY) as { value: string } | null
  return row?.value ?? null
}

// 保存 token 到 kv_state
function saveAuthToken(token: string): void {
  const db = getDatabase()
  db.run("INSERT OR REPLACE INTO kv_state (key, value) VALUES (?, ?)", [AUTH_TOKEN_KEY, token])
}

// 清除 token
function clearAuthToken(): void {
  const db = getDatabase()
  db.run("DELETE FROM kv_state WHERE key = ?", [AUTH_TOKEN_KEY])
}

export function createAuthRoutes() {
  const app = new Hono()

  // GET /auth/cloud-status — 前端判断是否启用云服务
  app.get('/auth/cloud-status', (c) => {
    const env = getEnv()
    return c.json({
      enabled: !!(env.YOUCLAW_WEBSITE_URL && env.YOUCLAW_API_URL),
    })
  })

  // GET /auth/login — 返回登录 URL（前端用浏览器打开）
  app.get('/auth/login', (c) => {
    const websiteUrl = getEnv().YOUCLAW_WEBSITE_URL
    if (!websiteUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }
    const host = c.req.header('host') || `localhost:${getEnv().PORT}`
    const redirectUri = `http://${host}/api/auth/callback`
    const loginUrl = `${websiteUrl}/login?redirect_uri=${encodeURIComponent(redirectUri)}&app_name=YouClaw`
    return c.json({ loginUrl })
  })

  // GET /auth/callback — 接收官网回调的 token
  app.get('/auth/callback', (c) => {
    const token = c.req.query('token')
    const logger = getLogger()

    if (!token) {
      return c.html(`
        <html><body style="font-family:system-ui;text-align:center;padding:60px">
          <h2>Login Failed</h2>
          <p>No token received.</p>
        </body></html>
      `, 400)
    }

    saveAuthToken(token)
    logger.info({ category: 'auth' }, 'Auth token saved from callback')

    return c.html(`
      <html><body style="font-family:system-ui;text-align:center;padding:60px">
        <h2 style="color:#22c55e">Login Successful</h2>
        <p>You can close this window and return to YouClaw.</p>
        <script>setTimeout(() => window.close(), 2000)</script>
      </body></html>
    `)
  })

  // GET /auth/user — 获取用户信息
  app.get('/auth/user', async (c) => {
    const apiUrl = getEnv().YOUCLAW_API_URL
    if (!apiUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }
    const token = getAuthToken()
    if (!token) {
      return c.json({ error: 'Not logged in' }, 401)
    }

    try {
      const res = await fetch(`${apiUrl}/api/oauth/user`, {
        headers: { rdxtoken: token },
      })

      if (!res.ok) {
        if (res.status === 401) {
          clearAuthToken()
          return c.json({ error: 'Token expired' }, 401)
        }
        return c.json({ error: 'Failed to fetch user info' }, 500)
      }

      const data = await res.json() as { success?: boolean; data?: { id?: number; displayName?: string; avatar?: string; email?: string } | null }
      // 官网返回 { success: true, data: null } 表示 token 无效
      if (!data.data) {
        clearAuthToken()
        return c.json({ error: 'Token expired' }, 401)
      }
      const u = data.data
      return c.json({
        id: u.id ? String(u.id) : '',
        name: u.displayName ?? '',
        avatar: u.avatar ?? '',
        email: u.email,
      })
    } catch (err) {
      const logger = getLogger()
      logger.error({ error: String(err), category: 'auth' }, 'Failed to fetch user info')
      return c.json({ error: 'Failed to fetch user info' }, 500)
    }
  })

  // POST /auth/logout — 退出登录
  app.post('/auth/logout', async (c) => {
    const token = getAuthToken()
    const logger = getLogger()
    const apiUrl = getEnv().YOUCLAW_API_URL

    if (token && apiUrl) {
      // 通知官网后端注销
      try {
        await fetch(`${apiUrl}/api/oauth/logout`, {
          method: 'POST',
          headers: { rdxtoken: token },
        })
      } catch {
        // 注销失败不影响本地清理
      }
    }

    clearAuthToken()
    logger.info({ category: 'auth' }, 'User logged out')
    return c.json({ ok: true })
  })

  // GET /auth/pay-url — 返回支付页 URL
  app.get('/auth/pay-url', (c) => {
    const websiteUrl = getEnv().YOUCLAW_WEBSITE_URL
    if (!websiteUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }
    const host = c.req.header('host') || `localhost:${getEnv().PORT}`
    const redirectUri = `http://${host}/api/auth/pay-callback`
    const payUrl = `${websiteUrl}/pay?redirect_uri=${encodeURIComponent(redirectUri)}`
    return c.json({ payUrl })
  })

  // GET /auth/pay-callback — 接收支付成功回调
  app.get('/auth/pay-callback', (c) => {
    const status = c.req.query('status')
    const orderId = c.req.query('order_id')
    const logger = getLogger()

    if (status === 'success') {
      logger.info({ category: 'auth', orderId }, 'Payment callback received')
      return c.html(`
        <html><body style="font-family:system-ui;text-align:center;padding:60px">
          <h2 style="color:#22c55e">Payment Successful</h2>
          <p>Your payment has been processed. You can close this window.</p>
          <script>setTimeout(() => window.close(), 2000)</script>
        </body></html>
      `)
    }

    return c.html(`
      <html><body style="font-family:system-ui;text-align:center;padding:60px">
        <h2>Payment Status</h2>
        <p>Status: ${status || 'unknown'}</p>
        <script>setTimeout(() => window.close(), 3000)</script>
      </body></html>
    `)
  })

  // POST /auth/upload — 代理文件上传到 ReadmeX
  app.post('/auth/upload', async (c) => {
    const apiUrl = getEnv().YOUCLAW_API_URL
    if (!apiUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }
    const token = getAuthToken()
    if (!token) {
      return c.json({ error: 'Not logged in' }, 401)
    }

    try {
      const body = await c.req.raw.clone().arrayBuffer()
      const contentType = c.req.header('content-type') || ''

      const res = await fetch(`${apiUrl}/api/file/upload`, {
        method: 'POST',
        headers: {
          rdxtoken: token,
          'content-type': contentType,
        },
        body,
      })

      if (!res.ok) {
        return c.json({ error: 'Upload failed' }, res.status)
      }

      const data = await res.json() as { data?: string }
      return c.json({ url: data.data })
    } catch (err) {
      const logger = getLogger()
      logger.error({ error: String(err), category: 'auth' }, 'File upload failed')
      return c.json({ error: 'Upload failed' }, 500)
    }
  })

  // POST /auth/update-profile — 修改用户名和头像
  app.post('/auth/update-profile', async (c) => {
    const apiUrl = getEnv().YOUCLAW_API_URL
    if (!apiUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }
    const token = getAuthToken()
    if (!token) {
      return c.json({ error: 'Not logged in' }, 401)
    }

    try {
      const body = await c.req.json() as { displayName?: string; avatar?: string }

      const res = await fetch(`${apiUrl}/api/oauth/update_profile`, {
        method: 'POST',
        headers: {
          rdxtoken: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        return c.json({ error: 'Update profile failed' }, res.status)
      }

      const data = await res.json() as { data?: { id?: number; displayName?: string; avatar?: string; email?: string } }
      const u = data.data
      // 映射为前端 AuthUser 格式
      return c.json({
        id: u?.id ? String(u.id) : '',
        name: u?.displayName ?? '',
        avatar: u?.avatar ?? '',
        email: u?.email,
      })
    } catch (err) {
      const logger = getLogger()
      logger.error({ error: String(err), category: 'auth' }, 'Update profile failed')
      return c.json({ error: 'Update profile failed' }, 500)
    }
  })

  // GET /auth/status — 检查登录状态（前端轮询用）
  app.get('/auth/status', (c) => {
    const token = getAuthToken()
    return c.json({ loggedIn: !!token })
  })

  return app
}
