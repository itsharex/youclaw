import { Hono } from 'hono'
import { getAuthToken } from './auth.ts'
import { getLogger } from '../logger/index.ts'
import { getEnv } from '../config/index.ts'

/**
 * 本地代理路由：将 SDK 的请求转发到云服务，附加 rdxtoken header
 * cloud 模式下 ANTHROPIC_BASE_URL 指向 http://localhost:{port}/api/proxy
 * SDK 调用 /api/proxy/v1/messages → 转发到云服务 /api/v1/messages
 */
export function createProxyRoutes() {
  const app = new Hono()

  // ALL /proxy/v1/messages — 转发到云服务
  app.all('/proxy/v1/messages', async (c) => {
    const apiUrl = getEnv().YOUCLAW_API_URL
    const logger = getLogger()

    if (!apiUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }

    const token = getAuthToken()
    if (!token) {
      return c.json({ error: 'Not logged in, cannot proxy to cloud' }, 401)
    }

    const targetUrl = `${apiUrl}/api/v1/messages`

    try {
      // 透传请求
      const headers: Record<string, string> = {
        rdxtoken: token,
      }

      // 透传 Content-Type 和其他必要 header
      const contentType = c.req.header('content-type')
      if (contentType) headers['content-type'] = contentType

      const accept = c.req.header('accept')
      if (accept) headers['accept'] = accept

      // 透传 anthropic 相关 header
      const anthropicVersion = c.req.header('anthropic-version')
      if (anthropicVersion) headers['anthropic-version'] = anthropicVersion

      const anthropicBeta = c.req.header('anthropic-beta')
      if (anthropicBeta) headers['anthropic-beta'] = anthropicBeta

      // 不透传 x-api-key（SDK 会发 'youclaw'，readmex 用 rdxtoken 认证）

      const body = c.req.method !== 'GET' ? await c.req.raw.clone().text() : undefined

      const res = await fetch(targetUrl, {
        method: c.req.method,
        headers,
        body,
      })

      // 流式响应透传
      if (res.headers.get('content-type')?.includes('text/event-stream')) {
        return new Response(res.body, {
          status: res.status,
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
          },
        })
      }

      // 普通 JSON 响应
      const data = await res.text()
      return new Response(data, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/json',
        },
      })
    } catch (err) {
      logger.error({ error: String(err), category: 'proxy' }, 'Proxy to cloud service failed')
      return c.json({ error: 'Proxy request failed' }, 502)
    }
  })

  return app
}
