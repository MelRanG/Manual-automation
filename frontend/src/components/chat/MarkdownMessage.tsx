// frontend/src/components/chat/MarkdownMessage.tsx
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface Props {
  content: string
  variant: "full" | "compact"
}

const FULL_CLASS =
  "prose prose-sm max-w-none text-[#191c1e] " +
  "prose-headings:my-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 " +
  "prose-li:my-0 prose-pre:my-2 prose-blockquote:my-2 " +
  "prose-code:before:hidden prose-code:after:hidden"

const COMPACT_CLASS =
  "prose prose-sm max-w-none text-[#191c1e] " +
  "prose-headings:my-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 " +
  "prose-li:my-0 prose-pre:my-1 prose-blockquote:my-1 " +
  "prose-code:before:hidden prose-code:after:hidden"

// sr_proposal 블록은 네트워크 응답에만 노출하고 UI에는 렌더링하지 않는다.
// 스트리밍 중에는 닫는 펜스가 아직 안 들어왔을 수 있어 부분 블록과 부분 헤더까지 함께 제거한다.
function stripSrProposalBlock(content: string): string {
  return content
    .replace(/\s*```sr_proposal[\s\S]*?(?:\n```|$)/g, "")
    .replace(/\s*```sr[a-z_]*\s*$/g, "")
}

export function MarkdownMessage({ content, variant }: Props) {
  const visible = stripSrProposalBlock(content)
  return (
    <div className={variant === "full" ? FULL_CLASS : COMPACT_CLASS}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{visible}</ReactMarkdown>
    </div>
  )
}
