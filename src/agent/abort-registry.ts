import { getLogger } from '../logger/index.ts'

interface AbortEntry {
  abortController: AbortController
  query: AsyncIterable<unknown> & { close?: () => void } | null
}

/**
 * Singleton registry that maps chatId -> abort handles.
 * Allows external callers (e.g. HTTP abort endpoint) to terminate a running query.
 */
class AbortRegistry {
  private entries = new Map<string, AbortEntry>()

  register(chatId: string, abortController: AbortController): void {
    this.entries.set(chatId, { abortController, query: null })
  }

  setQuery(chatId: string, q: AsyncIterable<unknown> & { close?: () => void }): void {
    const entry = this.entries.get(chatId)
    if (entry) {
      entry.query = q
    }
  }

  abort(chatId: string): boolean {
    const entry = this.entries.get(chatId)
    if (!entry) return false

    const logger = getLogger()
    logger.info({ chatId, category: 'agent' }, 'Query aborted by user')

    entry.abortController.abort()
    if (entry.query?.close) {
      try {
        entry.query.close()
      } catch {
        // close() may throw if already terminated
      }
    }
    this.entries.delete(chatId)
    return true
  }

  unregister(chatId: string): void {
    this.entries.delete(chatId)
  }

  has(chatId: string): boolean {
    return this.entries.has(chatId)
  }
}

export const abortRegistry = new AbortRegistry()
