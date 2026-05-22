// frontend/src/components/chat/ChatMessage.tsx
import type { ChatMessage as ChatMessageType, Citation, SRDraftCreated } from "@/lib/api"
import { MarkdownMessage } from "./MarkdownMessage"

interface Props {
  msg: ChatMessageType
  variant: "full" | "compact"
  citations: Citation[]
  srDraft?: SRDraftCreated
  srSentText?: string
  srSendingId: string | null
  srSendError?: string
  onSendSR?: (draft: SRDraftCreated) => void
  /** true면 "SR 보내기" 대신 "수정하기" + "승인" 버튼을 노출 (승인 = onSendSR). */
  srApprovalUi?: boolean
  canSubmitFeedback: boolean
  feedbackFor: string | null
  feedbackText: string
  feedbackSubmitting: boolean
  feedbackSuccess: string | null
  feedbackNotice?: string
  onOpenFeedback: (id: string) => void
  onCancelFeedback: () => void
  onFeedbackTextChange: (v: string) => void
  onSubmitFeedback: (id: string) => void
}

export function ChatMessageView(p: Props) {
  const { msg, variant, citations, srDraft } = p
  if (msg.role === "user") {
    return (
      <div className="flex justify-end w-full">
        <div className={
          variant === "full"
            ? "bg-[#1e40af] text-white rounded-2xl rounded-tr-none px-6 py-3 max-w-[85%] shadow-sm"
            : "bg-[#00288e] text-white rounded-lg rounded-tr-none p-3 text-sm shadow-sm max-w-[85%]"
        }>
          <p className={variant === "full" ? "text-base leading-relaxed whitespace-pre-wrap" : "text-sm whitespace-pre-wrap"}>{msg.content}</p>
        </div>
      </div>
    )
  }
  // assistant
  return (
    <div className={variant === "full" ? "flex gap-4 w-full max-w-[95%]" : "flex gap-3 max-w-[90%]"}>
      <div className={variant === "full"
        ? "shrink-0 w-8 h-8 rounded-full bg-[#d5e3fc] flex items-center justify-center border border-[#c4c5d5] mt-1"
        : "shrink-0 w-8 h-8 rounded-full bg-[#1e40af] text-white flex items-center justify-center"
      }>
        <span className="material-symbols-outlined text-base text-[#00288e]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
      </div>
      <div className="flex-1 space-y-3">
        <div className={variant === "full"
          ? "bg-white border border-[#c4c5d5] rounded-2xl rounded-tl-none px-6 py-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)]"
          : "bg-white border border-[#c4c5d5] rounded-lg rounded-tl-none p-3 text-sm text-[#191c1e] shadow-sm"
        }>
          {msg.content ? (
            <MarkdownMessage content={msg.content} variant={variant} />
          ) : (
            <span
              className={
                variant === "full"
                  ? "text-base text-[#757684] animate-pulse"
                  : "text-sm text-[#757684] animate-pulse"
              }
            >
              응답 생성 중...
            </span>
          )}

          {msg.id !== "streaming" && citations.length > 0 && variant === "full" && (
            <>
              <div className="h-px w-full bg-[#e0e3e5] my-4" />
              <div className="space-y-3">
                <div className="flex items-center gap-1 text-[#444653]">
                  <span className="material-symbols-outlined text-sm">menu_book</span>
                  <span className="text-xs font-semibold">참고 문서 (출처)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {citations.map((c, i) => (
                    <a key={i} href="#" className="flex flex-col gap-1 p-3 bg-[#f7f9fb] rounded-lg border border-[#c4c5d5] hover:border-[#b8c4ff] hover:bg-white hover:shadow-sm transition-all group">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-1 overflow-hidden">
                          <span className="material-symbols-outlined text-base text-[#00288e] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>description</span>
                          <span className="text-sm text-[#191c1e] font-semibold truncate group-hover:text-[#00288e] transition-colors">{c.document_title || "참고 문서"}</span>
                        </div>
                      </div>
                      {c.quote && (
                        <div className="text-xs text-[#444653] truncate flex items-center gap-1 mt-1">
                          <span className="material-symbols-outlined text-[14px]">link</span>{c.quote}
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            </>
          )}

          {msg.id !== "streaming" && citations.length > 0 && variant === "compact" && (
            <p className="text-xs text-[#444653] mt-2 pt-2 border-t border-dashed border-[#c4c5d5] flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">menu_book</span>
              출처: {citations.map(c => c.document_title).join(", ")}
            </p>
          )}
        </div>

        {srDraft && p.onSendSR && (
          <div className="border border-[#d7b46a] bg-[#fff8e6] rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-base text-[#92600a]">assignment</span>
                  <span className="text-xs font-bold text-[#92600a]">AI가 정리한 SR 초안</span>
                </div>
                <p className="text-sm font-semibold text-[#191c1e]">{srDraft.title}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white border border-[#e6d3a1] px-2 py-0.5 text-[10px] font-semibold text-[#92600a]">
                {srDraft.priority}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[#444653] whitespace-pre-wrap line-clamp-4">
              {srDraft.description}
            </p>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-[#757684]">검토 후 바로 Jira/Webhook으로 전송할 수 있습니다.</p>
              {p.srSentText ? (
                <span className="text-xs font-semibold text-emerald-700">{p.srSentText}</span>
              ) : p.srApprovalUi ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={p.srSendingId === srDraft.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#c4c5d5] bg-white px-3 py-1.5 text-xs font-semibold text-[#444653] hover:bg-[#f2f4f6] disabled:opacity-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">edit</span>
                    수정하기
                  </button>
                  <button
                    onClick={() => p.onSendSR!(srDraft)}
                    disabled={p.srSendingId === srDraft.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#15803d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#166534] disabled:opacity-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">check</span>
                    {p.srSendingId === srDraft.id ? "전송 중..." : "승인"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => p.onSendSR!(srDraft)}
                  disabled={p.srSendingId === srDraft.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#00288e] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1e40af] disabled:opacity-50 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">send</span>
                  {p.srSendingId === srDraft.id ? "전송 중..." : "SR 보내기"}
                </button>
              )}
            </div>
            {p.srSendError && (
              <p className="text-xs font-medium text-[#ba1a1a]">{p.srSendError}</p>
            )}
          </div>
        )}

        {msg.id !== "streaming" && msg.content && p.canSubmitFeedback && (
          <div className="flex items-center gap-4 pl-2">
            <div className="ml-auto">
              {p.feedbackSuccess === msg.id ? (
                <span className="text-xs text-emerald-600 font-medium">{p.feedbackNotice || "오류 제보 접수 완료"}</span>
              ) : p.feedbackFor === msg.id ? (
                <div className="bg-[#ffdad6]/30 border border-[#ffdad6] rounded-lg p-3 space-y-2 max-w-sm">
                  <p className="text-xs font-medium text-[#93000a]">어떤 내용이 실제와 다른가요?</p>
                  <textarea
                    placeholder="실제 내용을 알려주세요..."
                    rows={2}
                    value={p.feedbackText}
                    onChange={e => p.onFeedbackTextChange(e.target.value)}
                    className="w-full text-sm border border-[#c4c5d5] rounded px-3 py-2 focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => p.onSubmitFeedback(msg.id)} disabled={p.feedbackSubmitting || !p.feedbackText.trim()} className="bg-[#00288e] text-white text-xs font-semibold px-3 py-1.5 rounded hover:bg-[#1e40af] disabled:opacity-50">
                      {p.feedbackSubmitting ? "제출 중..." : "제출"}
                    </button>
                    <button onClick={p.onCancelFeedback} className="text-xs text-[#444653] px-3 py-1.5 rounded hover:bg-[#f2f4f6]">
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => p.onOpenFeedback(msg.id)} className="flex items-center gap-1 text-xs text-[#757684] hover:text-[#ba1a1a] hover:bg-[#ffdad6] px-3 py-1 rounded transition-all">
                  <span className="material-symbols-outlined text-base">report</span>
                  오류 수정 요청
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
