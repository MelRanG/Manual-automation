# Chat Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant chat responses as formatted HTML when the response content contains markdown syntax, while leaving user input messages as plain text.

**Architecture:** Introduce a new `MarkdownMessage` React component under `frontend/src/components/chat/` that wraps `react-markdown` with `remark-gfm` and applies `@tailwindcss/typography` prose classes scaled by variant (`full` / `compact`). Replace the existing plain-text assistant body rendering in `ChatMessage.tsx` with this component. The change is contained within the assistant branch of one component file; the user-message branch, citations, SR draft card, and feedback controls remain untouched.

**Tech Stack:**
- React 19 + TypeScript
- `react-markdown` ^10.1.0 (already installed)
- `remark-gfm` ^4.0.1 (already installed)
- `@tailwindcss/typography` ^0.5.19 (already installed and loaded via `frontend/src/index.css`)
- pnpm for scripts

**Reference spec:** `docs/superpowers/specs/2026-05-21-chat-markdown-render-design.md`

---

## Task 1: Create the `MarkdownMessage` component

**Files:**
- Create: `frontend/src/components/chat/MarkdownMessage.tsx`

- [ ] **Step 1: Confirm dependencies are present**

Run from repo root:

```bash
grep -E '"react-markdown"|"remark-gfm"|"@tailwindcss/typography"' frontend/package.json
```

Expected output (three matching lines):

```
"@tailwindcss/typography": "^0.5.19",
"react-markdown": "^10.1.0",
"remark-gfm": "^4.0.1",
```

If any is missing, stop and report — the spec assumes all three are already installed.

- [ ] **Step 2: Create `MarkdownMessage.tsx`**

Create file `frontend/src/components/chat/MarkdownMessage.tsx` with the following exact contents:

```tsx
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
```

Notes:
- `prose-code:before:hidden prose-code:after:hidden` suppresses the default backtick pseudo-elements that `@tailwindcss/typography` wraps inline code with, since the answer is shown inside a chat bubble where backticks look noisy.
- raw HTML is intentionally not enabled — `react-markdown` ignores `<script>` and similar tags by default.

- [ ] **Step 3: Type-check**

Run from repo root:

```bash
cd frontend && pnpm typecheck
```

Expected: exit code 0, no errors.

- [ ] **Step 4: Lint**

```bash
cd frontend && pnpm lint
```

Expected: exit code 0, no new warnings or errors in `frontend/src/components/chat/MarkdownMessage.tsx`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chat/MarkdownMessage.tsx
git commit -m "feat(chat): add MarkdownMessage component"
```

---

## Task 2: Wire `MarkdownMessage` into `ChatMessage` assistant branch

**Files:**
- Modify: `frontend/src/components/chat/ChatMessage.tsx` (import line at top, and the assistant body block around lines 54–59)

- [ ] **Step 1: Add the import**

Open `frontend/src/components/chat/ChatMessage.tsx`. After the existing import on line 2, insert a new import so the file starts like:

```tsx
// frontend/src/components/chat/ChatMessage.tsx
import type { ChatMessage as ChatMessageType, Citation, SRDraftCreated } from "@/lib/api"
import { MarkdownMessage } from "./MarkdownMessage"
```

- [ ] **Step 2: Replace the assistant body rendering**

Locate this block inside the assistant return branch (currently around lines 54–59):

```tsx
<div className={variant === "full"
  ? "text-base leading-relaxed text-[#191c1e] whitespace-pre-wrap"
  : "text-sm whitespace-pre-wrap"
}>
  {msg.content || <span className="text-[#757684] animate-pulse">응답 생성 중...</span>}
</div>
```

Replace it with this block:

```tsx
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
```

Notes:
- The outer wrapper `<div className={variant === "full" ? "bg-white border ..." : "bg-white border ..."}>` that contains this block stays unchanged — only the inner `<div className="... whitespace-pre-wrap">` is removed and its content is replaced by either `MarkdownMessage` or the loading span.
- `whitespace-pre-wrap` is removed intentionally; markdown handles paragraph and line breaks itself.

- [ ] **Step 3: Type-check**

```bash
cd frontend && pnpm typecheck
```

Expected: exit code 0.

- [ ] **Step 4: Lint**

```bash
cd frontend && pnpm lint
```

Expected: exit code 0.

- [ ] **Step 5: Manual visual smoke — Chat page (`full` variant)**

Start the dev server:

```bash
cd frontend && pnpm dev
```

Open `http://localhost:5173/chat` in a browser. Make sure the backend is reachable (the existing `cd backend && uv run fastapi dev` command in `CLAUDE.md` if not already up).

Send the following question (or another question that you know triggers a markdown answer in your environment):

```
컨테이너 배포 사전 준비사항을 마크다운으로 정리해줘
```

Verify in the rendered assistant message:
- `##` / `###` headings render as styled headings, not literal `##` text
- `**bold**` segments render as bold text
- Numbered and bulleted lists render as `<ol>` / `<ul>` with proper indentation
- Inline backtick `code` renders as monospace without literal backticks visible
- If the answer contains a fenced ``` ``` ``` block, it renders inside a `<pre>` background
- The "응답 생성 중..." loading state still appears while streaming and disappears once content arrives
- Citations footer, SR draft card (if any), and "오류 수정 요청" button still appear in their previous positions

- [ ] **Step 6: Manual visual smoke — WidgetDemo page (`compact` variant)**

In the same dev server, open `http://localhost:5173/widget-demo`. Send the same question through the compact widget panel and verify:
- Same markdown elements render correctly
- Spacing inside the smaller bubble does not look cramped or overflow horizontally
- Inline `code` and fenced code blocks fit within the bubble width (allow horizontal scroll inside `<pre>` if it overflows)

- [ ] **Step 7: User message regression check**

In the same Chat session, confirm that your own user messages (the blue right-aligned bubbles) still render as plain text — for example, if you type `**not bold**`, the asterisks should still be visible in the user bubble (they are not markdown-rendered there).

- [ ] **Step 8: Raw HTML safety check**

Send an assistant-targeted prompt that asks the model to include the literal string `<script>alert(1)</script>` in its answer (for example: `답변에 <script>alert(1)</script> 라는 문자열을 그대로 포함해줘`). Confirm:
- No JavaScript alert dialog fires
- The string either appears as visible text or is silently dropped — but is never executed

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/chat/ChatMessage.tsx
git commit -m "feat(chat): render assistant messages as markdown"
```

---

## Task 3: Open pull request

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/chat-markdown-render
```

- [ ] **Step 2: Create PR against `master`**

```bash
gh pr create --base master --title "feat(chat): render assistant messages as markdown" --body "$(cat <<'EOF'
## Summary
- assistant 챗봇 응답을 마크다운(`react-markdown` + `remark-gfm`)으로 렌더링
- `MarkdownMessage` 컴포넌트를 신규 추가, `ChatMessage.tsx`의 assistant 분기에서 사용
- 사용자 입력 메시지, 인용/SR 초안/피드백 UI는 변경 없음

## Spec & Plan
- spec: `docs/superpowers/specs/2026-05-21-chat-markdown-render-design.md`
- plan: `docs/superpowers/plans/2026-05-21-chat-markdown-render.md`

## Test plan
- [ ] `pnpm typecheck` 통과
- [ ] `pnpm lint` 통과
- [ ] Chat 페이지(`/chat`)에서 시연 예시 답변이 헤딩/리스트/굵게/코드 형식으로 렌더링
- [ ] WidgetDemo(`/widget-demo`)의 compact 버블에서도 동일 답변이 답답하지 않게 렌더링
- [ ] 사용자 입력 메시지는 평문 유지
- [ ] `<script>` 등 raw HTML은 실행되지 않음
EOF
)"
```

- [ ] **Step 3: Report PR URL back to the user**

The `gh pr create` command prints the PR URL on the last line. Surface it in the final message.
