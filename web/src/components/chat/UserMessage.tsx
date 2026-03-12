import { User } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Message as AIMessage, MessageContent } from '@/components/ai-elements/message'
import { useI18n } from '@/i18n'
import type { Message } from '@/hooks/useChat'

export function UserMessage({ message }: { message: Message }) {
  const { t } = useI18n()

  return (
    <AIMessage from="user" data-testid="message-user">
      <div className="flex gap-3 py-3 flex-row-reverse">
        <Avatar className="h-8 w-8 mt-0.5">
          <AvatarFallback className="text-[10px] font-semibold bg-blue-500/20 text-blue-500">
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 flex flex-col items-end">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            {t.chat.you}
            <span className="ml-2 text-[10px] opacity-60">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <MessageContent>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </MessageContent>
        </div>
      </div>
    </AIMessage>
  )
}
