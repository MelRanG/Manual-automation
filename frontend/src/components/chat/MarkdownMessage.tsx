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

export function MarkdownMessage({ content, variant }: Props) {
  return (
    <div className={variant === "full" ? FULL_CLASS : COMPACT_CLASS}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
