import { useState, useCallback, useRef, useEffect } from 'react'
import { sendMessage, getMessages } from '../api/client'
import { useSSE } from './useSSE'
import type { Attachment } from '../types/attachment'

export type ToolUseItem = {
  id: string
  name: string
  input?: string
  status: 'running' | 'done'
}

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolUse?: ToolUseItem[]  // 新增
  attachments?: Attachment[]
}

export function useChat(agentId: string) {
  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingToolUse, setPendingToolUse] = useState<ToolUseItem[]>([])
  const [chatStatus, setChatStatus] = useState<'submitted' | 'streaming' | 'ready' | 'error'>('ready')
  const [showInsufficientCredits, setShowInsufficientCredits] = useState(false)

  const pendingToolUseRef = useRef<ToolUseItem[]>([])
  useEffect(() => { pendingToolUseRef.current = pendingToolUse }, [pendingToolUse])

  // 记录最后一次收到 SSE 事件的时间，用于超时兜底
  const lastEventTimeRef = useRef<number>(0)

  const { close: closeSSE } = useSSE(chatId, (event) => {
    lastEventTimeRef.current = Date.now()
    switch (event.type) {
      case 'stream':
        setStreamingText(prev => prev + (event.text ?? ''))
        break
      case 'tool_use':
        setPendingToolUse(prev => {
          const updated = prev.map(t => t.status === 'running' ? { ...t, status: 'done' as const } : t)
          return [...updated, {
            id: Date.now().toString(),
            name: event.tool ?? 'unknown',
            input: event.input,
            status: 'running',
          }]
        })
        break
      case 'complete': {
        const finalToolUse = pendingToolUseRef.current.map(t => ({ ...t, status: 'done' as const }))
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: event.fullText ?? '',
          timestamp: new Date().toISOString(),
          toolUse: finalToolUse.length > 0 ? finalToolUse : undefined,
        }])
        setStreamingText('')
        setPendingToolUse([])
        break
      }
      case 'processing':
        setIsProcessing(event.isProcessing ?? false)
        break
      case 'error':
        console.log('[useChat] error event received:', { errorCode: event.errorCode, error: event.error })
        setChatStatus('error')
        setTimeout(() => setChatStatus('ready'), 2000)
        // 积分不足时弹充值弹窗
        if (event.errorCode === 'INSUFFICIENT_CREDITS') {
          console.log('[useChat] INSUFFICIENT_CREDITS detected, showing dialog')
          setShowInsufficientCredits(true)
        }
        // 显示错误信息给用户，而不是静默吞掉
        if (event.error) {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'assistant',
            content: `⚠️ ${event.error}`,
            timestamp: new Date().toISOString(),
          }])
        }
        setStreamingText('')
        setIsProcessing(false)
        break
    }
  })

  // SSE 兜底：处理中超过 8 秒没收到任何事件时，主动查询后端消息
  const chatIdRef = useRef(chatId)
  useEffect(() => { chatIdRef.current = chatId }, [chatId])

  useEffect(() => {
    if (!isProcessing) return
    const timer = setInterval(async () => {
      const cid = chatIdRef.current
      if (!cid) return
      // 距离上次事件超过 8 秒，主动拉取
      if (Date.now() - lastEventTimeRef.current < 8000) return
      try {
        const msgs = await getMessages(cid)
        const lastMsg = msgs[msgs.length - 1]
        if (lastMsg && lastMsg.is_bot_message) {
          // 后端已有 bot 回复，说明 complete 事件丢失了，手动恢复
          setMessages(msgs.map(m => ({
            id: m.id,
            role: m.is_bot_message ? 'assistant' as const : 'user' as const,
            content: m.content,
            timestamp: m.timestamp,
            attachments: (m as { attachments?: Attachment[] | null }).attachments ?? undefined,
          })))
          setStreamingText('')
          setPendingToolUse([])
          setIsProcessing(false)
        }
      } catch {
        // 查询失败忽略，下次重试
      }
    }, 5000)
    return () => clearInterval(timer)
  }, [isProcessing])

  useEffect(() => {
    if (chatStatus === 'error') return // 保持 error 状态直到 setTimeout 重置
    if (isProcessing && !streamingText) setChatStatus('submitted')
    else if (isProcessing && streamingText) setChatStatus('streaming')
    else setChatStatus('ready')
  }, [isProcessing, streamingText, chatStatus])

  const send = useCallback(async (prompt: string, browserProfileId?: string, attachments?: Attachment[]) => {
    // 新对话时预生成 chatId，让 SSE 连接提前建立，避免错过快速返回的 error 事件
    const effectiveChatId = chatId ?? `web:${crypto.randomUUID()}`
    if (!chatId) {
      setChatId(effectiveChatId)
    }

    // 添加用户消息到列表
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
      attachments,
    }])
    setIsProcessing(true)
    setStreamingText('')

    // 等待一帧让 React 完成渲染、建立 SSE 连接，避免错过 error 事件
    if (!chatId) {
      await new Promise(r => setTimeout(r, 100))
    }

    try {
      await sendMessage(agentId, prompt, effectiveChatId, browserProfileId, attachments)
    } catch (err) {
      // 请求失败时显示错误并重置状态
      const errorMsg = err instanceof Error ? err.message : String(err)
      // 检查是否包含积分不足关键词
      if (/insufficient|credit|balance|quota/i.test(errorMsg)) {
        setShowInsufficientCredits(true)
      }
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `⚠️ ${errorMsg}`,
        timestamp: new Date().toISOString(),
      }])
      setIsProcessing(false)
    }
  }, [agentId, chatId])

  const loadChat = useCallback(async (existingChatId: string) => {
    const msgs = await getMessages(existingChatId)
    if (msgs.length === 0) throw new Error('Chat not found or empty')
    setChatId(existingChatId)
    setMessages(msgs.map(m => ({
      id: m.id,
      role: m.is_bot_message ? 'assistant' as const : 'user' as const,
      content: m.content,
      timestamp: m.timestamp,
      attachments: (m as { attachments?: Attachment[] | null }).attachments ?? undefined,
    })))
  }, [])

  const newChat = useCallback(() => {
    setChatId(null)
    setMessages([])
    setStreamingText('')
    setIsProcessing(false)
    setPendingToolUse([])
  }, [])

  const stop = useCallback(() => {
    closeSSE()
    setIsProcessing(false)
    setStreamingText('')
    setPendingToolUse([])
  }, [closeSSE])

  return { chatId, messages, streamingText, isProcessing, pendingToolUse, chatStatus, send, loadChat, newChat, stop, showInsufficientCredits, setShowInsufficientCredits }
}
