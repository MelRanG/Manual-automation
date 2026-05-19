import { useState } from "react"

interface TagEditorProps {
  tags: string[]
  onChange: (tags: string[]) => void
  onSuggest: () => Promise<string[]>
}

function tagDepthColor(tag: string) {
  const depth = tag.split("/").length
  if (depth === 1) return "bg-[#dde1ff] text-[#00288e]"
  if (depth === 2) return "bg-[#d5e3fc] text-[#1a56db]"
  return "bg-[#e8f0fe] text-[#444653]"
}

export function TagEditor({ tags, onChange, onSuggest }: TagEditorProps) {
  const [input, setInput] = useState("")
  const [suggesting, setSuggesting] = useState(false)
  const [suggested, setSuggested] = useState<string[]>([])

  const addTag = (tag: string) => {
    const t = tag.trim()
    if (!t || tags.includes(t)) return
    onChange([...tags, t])
    setInput("")
  }

  const removeTag = (tag: string) => {
    onChange(tags.filter(t => t !== tag))
  }

  const acceptSuggested = (tag: string) => {
    if (!tags.includes(tag)) onChange([...tags, tag])
    setSuggested(prev => prev.filter(t => t !== tag))
  }

  const acceptAll = () => {
    const newTags = suggested.filter(t => !tags.includes(t))
    onChange([...tags, ...newTags])
    setSuggested([])
  }

  const handleSuggest = async () => {
    setSuggesting(true)
    try {
      const result = await onSuggest()
      setSuggested(result.filter(t => !tags.includes(t)))
    } catch {
      // ignore
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* 현재 태그 */}
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {tags.length === 0 && (
          <span className="text-xs text-[#757684] py-1">태그 없음</span>
        )}
        {tags.map(tag => (
          <span key={tag} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${tagDepthColor(tag)}`}>
            {tag.split("/").map((part, i) => (
              <span key={i} className="flex items-center gap-0.5">
                {i > 0 && <span className="opacity-40 text-[10px]">/</span>}
                {part}
              </span>
            ))}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
            >
              <span className="material-symbols-outlined text-[12px]">close</span>
            </button>
          </span>
        ))}
      </div>

      {/* AI 추천 태그 */}
      {suggested.length > 0 && (
        <div className="p-3 bg-[#f7f9fb] rounded-lg border border-[#e0e3e5] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#444653] flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px] text-[#00288e]">auto_awesome</span>
              AI 추천 태그
            </span>
            <button
              type="button"
              onClick={acceptAll}
              className="text-xs text-[#00288e] hover:underline"
            >
              모두 추가
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggested.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => acceptSuggested(tag)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-[#c4c5d5] hover:border-[#00288e] transition-colors ${tagDepthColor(tag)}`}
              >
                <span className="material-symbols-outlined text-[11px]">add</span>
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 직접 입력 + AI 추천 버튼 */}
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] outline-none"
          placeholder="태그 입력 (예: 업무/재무/정산) — Enter로 추가"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); addTag(input) }
          }}
        />
        <button
          type="button"
          onClick={() => addTag(input)}
          className="px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#444653] hover:bg-[#f2f4f6] transition-colors"
        >
          추가
        </button>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={suggesting}
          className="px-3 py-2 border border-[#00288e] text-[#00288e] rounded-lg text-sm font-medium hover:bg-[#e8f0fe] disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {suggesting
            ? <span className="material-symbols-outlined text-[14px] animate-spin">refresh</span>
            : <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
          }
          {suggesting ? "분석 중..." : "AI 추천"}
        </button>
      </div>
      <p className="text-[11px] text-[#757684]">
        "/" 로 계층 구분 (최대 3단계). 예: <code className="bg-[#f2f4f6] px-1 rounded">업무/재무</code>, <code className="bg-[#f2f4f6] px-1 rounded">시스템/ERP/정산</code>
      </p>
    </div>
  )
}
