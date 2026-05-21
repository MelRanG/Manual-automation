// frontend/src/components/chat/ChatPanel.tsx
import { useRef, useEffect } from "react"
import type { ChatSessionState } from "@/hooks/useChatSession"
import { ChatMessageView } from "./ChatMessage"
import { ChatInput } from "./ChatInput"

interface Props {
  chat: ChatSessionState
  variant: "full" | "compact"
  emptyState?: React.ReactNode
}

export function ChatPanel({ chat, variant, emptyState }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chat.messages])

  return (
    <div className={variant === "full" ? "flex-1 flex flex-col bg-[#f7f9fb] relative" : "flex flex-col flex-1 bg-[#f7f9fb] overflow-hidden"}>
      <div className={variant === "full"
        ? "flex-1 overflow-y-auto p-6 flex flex-col items-center"
        : "flex-1 p-4 overflow-y-auto flex flex-col gap-4"
      }>
        <div className={variant === "full" ? "w-full max-w-4xl space-y-6 pb-8" : "w-full space-y-3"}>
          {chat.messages.length === 0 && emptyState}
          {chat.messages.map((msg) => (
            <ChatMessageView
              key={msg.id}
              msg={msg}
              variant={variant}
              citations={
                msg.citations?.length
                  ? msg.citations
                  : chat.citationsByMessage[msg.id]
                    || (msg === chat.messages[chat.messages.length - 1] ? chat.citations : [])
              }
              srDraft={chat.srDraftsByMessage[msg.id]}
              srSentText={chat.srSentById[chat.srDraftsByMessage[msg.id]?.id]}
              srSendingId={chat.srSendingId}
              srSendError={chat.srSendErrorById[chat.srDraftsByMessage[msg.id]?.id]}
              onSendSR={chat.canSubmitSR ? chat.sendSR : undefined}
              canSubmitFeedback={chat.canSubmitFeedback}
              feedbackFor={chat.feedbackFor}
              feedbackText={chat.feedbackText}
              feedbackSubmitting={chat.feedbackSubmitting}
              feedbackSuccess={chat.feedbackSuccess}
              feedbackNotice={chat.feedbackNotice[msg.id]}
              onOpenFeedback={chat.openFeedback}
              onCancelFeedback={chat.cancelFeedback}
              onFeedbackTextChange={chat.setFeedbackText}
              onSubmitFeedback={chat.submitFeedback}
            />
          ))}
          <div ref={endRef} />
        </div>
      </div>

      {chat.warnings.length > 0 && (
        <div className="border-t border-[#c4c5d5] px-4 py-2 bg-[#ffdbce]/20">
          <div className="flex items-center gap-2 text-[#611e00]">
            <span className="material-symbols-outlined text-base">warning</span>
            <span className="text-xs font-medium">
              주의: 이 답변은 신뢰도가 낮은 문서를 참조합니다 — {chat.warnings.map(w => w.title).join(", ")}
            </span>
          </div>
        </div>
      )}

      <ChatInput
        variant={variant}
        chatMode={chat.chatMode}
        onChangeMode={chat.setChatMode}
        showModeTabs={chat.canSubmitSR}
        input={chat.input}
        onInputChange={chat.setInput}
        onSend={chat.send}
        loading={chat.loading}
      />
    </div>
  )
}
