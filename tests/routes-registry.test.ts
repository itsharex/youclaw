import { describe, expect, test } from 'bun:test'
import { loadEnv } from '../src/config/index.ts'
import { initLogger } from '../src/logger/index.ts'
import { createRegistryRoutes } from '../src/routes/registry.ts'

loadEnv()
initLogger()

describe('registry routes', () => {
  test('GET /registry/recommended returns marketplace items', async () => {
    const app = createRegistryRoutes({
      listMarketplace: async () => ({
        items: [
          {
            slug: 'coding',
            displayName: 'Coding',
            summary: 'Code better',
            installed: true,
            installSource: 'clawhub',
            installedVersion: '1.0.0',
            latestVersion: '1.1.0',
            hasUpdate: true,
            tags: ['coding'],
            source: 'clawhub',
          },
        ],
        nextCursor: null,
        source: 'clawhub',
        query: '',
        sort: 'trending',
      }),
    } as any)

    const res = await app.request('/registry/recommended')
    const body = await res.json() as Array<{ slug: string; installed: boolean; hasUpdate: boolean }>

    expect(res.status).toBe(200)
    expect(body).toEqual([
      {
        slug: 'coding',
        displayName: 'Coding',
        summary: 'Code better',
        installed: true,
        installSource: 'clawhub',
        installedVersion: '1.0.0',
        latestVersion: '1.1.0',
        hasUpdate: true,
        tags: ['coding'],
        source: 'clawhub',
      },
    ])
  })

  test('GET /registry/marketplace returns a paged payload', async () => {
    const app = createRegistryRoutes({
      listMarketplace: async ({ query, cursor, sort, limit }: any) => ({
        items: [],
        nextCursor: cursor ?? 'next-page',
        source: 'clawhub',
        query,
        sort,
        limit,
      }),
    } as any)

    const res = await app.request('/registry/marketplace?q=code&cursor=abc&sort=downloads&limit=10')
    const body = await res.json() as { query: string; sort: string; nextCursor: string }

    expect(res.status).toBe(200)
    expect(body.query).toBe('code')
    expect(body.sort).toBe('downloads')
    expect(body.nextCursor).toBe('abc')
  })

  test('GET /registry/marketplace/:slug returns detail', async () => {
    const app = createRegistryRoutes({
      listMarketplace: async () => ({ items: [], nextCursor: null, source: 'clawhub', query: '', sort: 'trending' }),
      getMarketplaceSkill: async () => ({
        slug: 'coding',
        displayName: 'Coding',
        summary: 'Code better',
        installed: false,
        hasUpdate: false,
        latestVersion: '1.0.0',
        tags: ['coding'],
        source: 'clawhub',
        ownerHandle: 'jerry',
      }),
    } as any)

    const res = await app.request('/registry/marketplace/coding')
    const body = await res.json() as { slug: string; ownerHandle: string }

    expect(res.status).toBe(200)
    expect(body.slug).toBe('coding')
    expect(body.ownerHandle).toBe('jerry')
  })

  test('POST /registry/install returns 400 when slug is missing', async () => {
    const app = createRegistryRoutes({
      listMarketplace: async () => ({ items: [], nextCursor: null, source: 'clawhub', query: '', sort: 'trending' }),
      installSkill: async () => {},
      updateSkill: async () => {},
      uninstallSkill: async () => {},
    } as any)

    const res = await app.request('/registry/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
  })

  test('POST /registry/install returns ok on success', async () => {
    let installedSlug = ''
    const app = createRegistryRoutes({
      listMarketplace: async () => ({ items: [], nextCursor: null, source: 'clawhub', query: '', sort: 'trending' }),
      installSkill: async (slug: string) => {
        installedSlug = slug
      },
      updateSkill: async () => {},
      uninstallSkill: async () => {},
    } as any)

    const res = await app.request('/registry/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'coding' }),
    })
    const body = await res.json() as { ok: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(installedSlug).toBe('coding')
  })

  test('POST /registry/install maps upstream download failures to 502', async () => {
    const app = createRegistryRoutes({
      listMarketplace: async () => ({ items: [], nextCursor: null, source: 'clawhub', query: '', sort: 'trending' }),
      installSkill: async () => {
        throw new Error('Download failed: 503 Service Unavailable')
      },
      updateSkill: async () => {},
      uninstallSkill: async () => {},
    } as any)

    const res = await app.request('/registry/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'coding' }),
    })
    const body = await res.json() as { ok: boolean; error: string }

    expect(res.status).toBe(502)
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Download failed: 503 Service Unavailable')
  })

  test('POST /registry/update returns ok on success', async () => {
    let updatedSlug = ''
    const app = createRegistryRoutes({
      listMarketplace: async () => ({ items: [], nextCursor: null, source: 'clawhub', query: '', sort: 'trending' }),
      installSkill: async () => {},
      updateSkill: async (slug: string) => {
        updatedSlug = slug
      },
      uninstallSkill: async () => {},
    } as any)

    const res = await app.request('/registry/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'coding' }),
    })
    const body = await res.json() as { ok: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(updatedSlug).toBe('coding')
  })

  test('POST /registry/uninstall returns ok on success', async () => {
    let uninstalledSlug = ''
    const app = createRegistryRoutes({
      listMarketplace: async () => ({ items: [], nextCursor: null, source: 'clawhub', query: '', sort: 'trending' }),
      installSkill: async () => {},
      updateSkill: async () => {},
      uninstallSkill: async (slug: string) => {
        uninstalledSlug = slug
      },
    } as any)

    const res = await app.request('/registry/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'coding' }),
    })
    const body = await res.json() as { ok: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(uninstalledSlug).toBe('coding')
  })
})
