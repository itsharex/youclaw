export interface InboundMessage {
  id: string
  chatId: string          // "tg:123456" 或 "web:uuid" 格式
  sender: string
  senderName: string
  content: string
  timestamp: string
  isGroup: boolean
}

export interface Channel {
  name: string
  connect(): Promise<void>
  sendMessage(chatId: string, text: string): Promise<void>
  isConnected(): boolean
  ownsChatId(chatId: string): boolean
  disconnect(): Promise<void>
}

export type OnInboundMessage = (message: InboundMessage) => void
