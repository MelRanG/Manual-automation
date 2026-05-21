// frontend/src/components/chat/ChatInput.tsx
import type { ChatMode } from "@/hooks/useChatSession"

interface Props {
  variant: "full" | "compact"
  chatMode: ChatMode
  onChangeMode: (m: ChatMode) => void
  showModeTabs: boolean
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  loading: boolean
}

export function ChatInput({
  variant, chatMode, onChangeMode, showModeTabs,
  input, onInputChange, onSend, loading,
}: Props) {
  const placeholder = chatMode === "change_request"
    ? (variant === "full" ? "어떤 변경이 필요한지 설명해주세요..." : "변경 요청 내용을 입력하세요...")
    : (variant === "full" ? "문서 내용에 대해 질문해보세요..." : "질문을 입력하세요...")

  return (
    <div className={variant === "full" ? "bg-[#f7f9fb]/80 backdrop-blur-md border-t border-[#c4c5d5] p-4 flex flex-col items-center gap-2" : "p-3 bg-white border-t border-[#c4c5d5] flex flex-col gap-2"}>
      {showModeTabs && (
        <div className={variant === "full"
          ? "w-full max-w-4xl flex items-center gap-1"
          : "flex items-center gap-1 mb-1"
        }>
          <button
            onClick={() => onChangeMode("question")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
              chatMode === "question" ? "bg-[#00288e] text-white shadow-sm" : "text-[#444653] hover:bg-[#f2f4f6]"
            }`}
          >
            <span className="material-symbols-outlined text-sm">help</span>질문하기
          </button>
          <button
            onClick={() => onChangeMode("change_request")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
              chatMode === "change_request" ? "bg-[#b45309] text-white shadow-sm" : "text-[#444653] hover:bg-[#f2f4f6]"
            }`}
          >
            <span className="material-symbols-outlined text-sm">edit_note</span>변경 요청
          </button>
        </div>
      )}
      <div className={variant === "full"
        ? "w-full max-w-4xl bg-white border-2 border-[#c4c5d5] focus-within:border-[#00288e] focus-within:ring-2 focus-within:ring-[#dde1ff] transition-all rounded-xl flex items-end p-1"
        : "flex items-center gap-3"
      }>
        {variant === "compact" ? (
          <input
            className="flex-1 bg-[#f2f4f6] border-none rounded-full px-4 py-2 text-sm focus:ring-1 focus:ring-[#00288e] outline-none text-[#191c1e]"
            placeholder={placeholder}
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onSend()}
            disabled={loading}
          />
        ) : (
          <textarea
            className="flex-1 max-h-64 min-h-[60px] bg-transparent border-none focus:ring-0 resize-none text-base text-[#191c1e] py-2 px-2 outline-none whitespace-pre-wrap break-words"
            placeholder={placeholder}
            rows={2}
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend() } }}
            disabled={loading}
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
        )}
        <button
          onClick={onSend}
          disabled={loading || !input.trim()}
          className={variant === "full"
            ? "p-2 m-1 bg-[#00288e] text-white rounded-lg hover:bg-[#1e40af] transition-all shrink-0 flex items-center justify-center h-10 w-10 disabled:opacity-50"
            : "w-10 h-10 rounded-full bg-[#00288e] text-white flex items-center justify-center hover:bg-[#1e40af] shrink-0 disabled:opacity-50"
          }
        >
          <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
        </button>
      </div>
    </div>
  )
}
