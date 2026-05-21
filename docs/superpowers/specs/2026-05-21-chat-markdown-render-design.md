# 챗봇 응답 마크다운 렌더링 설계

작성일: 2026-05-21
대상 브랜치: `feat/chat-markdown-render`

## 배경

LLM이 반환하는 챗봇 답변이 마크다운 문법(`##` 헤딩, `**굵게**`, 번호/불릿 리스트, `>` 인용, `` ` ``코드 등)을 포함하지만, 프론트엔드에서 그대로 평문 텍스트로 출력되고 있다. 사용자가 답변을 시각적으로 빠르게 파악할 수 있도록 마크다운을 HTML로 렌더링해 표시한다.

## 적용 범위

- 적용 대상 컴포넌트: `frontend/src/components/chat/ChatMessage.tsx`의 assistant 메시지 분기
- 적용되는 페이지(이 컴포넌트를 공유):
  - `frontend/src/pages/Chat.tsx` (`variant="full"`)
  - `frontend/src/pages/WidgetDemo.tsx` (`variant="compact"`)
- 적용 외:
  - 사용자 입력 메시지(role === "user")는 평문 유지
  - `frontend/src/widget/main.ts` 임베드 위젯은 이번 범위에서 제외

## 사용 라이브러리

- `react-markdown` (이미 설치, ^10.1.0)
- `remark-gfm` (이미 설치, ^4.0.1) — 테이블, 작업 목록, 취소선, autolink 지원
- 추가 의존성 없음

배제한 옵션:
- `rehype-highlight` / `react-syntax-highlighter`: 시연 일정상 추가 의존성과 테마 조정 비용 대비 효용 낮음. 필요 시 추후 한 줄 추가로 도입 가능.
- `rehype-sanitize`: 원본 HTML을 허용하지 않으므로 불필요(react-markdown 기본 동작이 raw HTML을 무시).

## 컴포넌트 구조

신규 파일: `frontend/src/components/chat/MarkdownMessage.tsx`

```tsx
interface Props {
  content: string
  variant: "full" | "compact"
}

export function MarkdownMessage({ content, variant }: Props) { ... }
```

- `react-markdown`을 `prose` 컨테이너로 감싸 렌더링한다.
- variant 별로 적절한 prose 크기와 간격 override를 적용한다.

`ChatMessage.tsx` 변경:

- assistant 메시지 본문 영역에서 기존 `<div className="... whitespace-pre-wrap">{msg.content}</div>`를 `<MarkdownMessage content={msg.content} variant={variant} />`로 교체.
- `whitespace-pre-wrap`은 제거(마크다운 단락 처리와 충돌).
- 빈 content일 때 표시되는 "응답 생성 중..." 스피너는 기존 로직 유지.
- 인용(citations), SR 초안 카드, 피드백 버튼 등 메시지 외부 요소는 MarkdownMessage 외부에 그대로 둔다.

## 스타일

`@tailwindcss/typography`는 이미 설치되어 있고 `frontend/src/index.css`의 `@plugin "@tailwindcss/typography"`로 로드 중이다.

`MarkdownMessage` 컨테이너 클래스:

- 공통: `prose max-w-none text-[#191c1e]`
- `variant === "full"`:
  - `prose-sm`
  - 간격 override: `prose-headings:my-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-pre:my-2 prose-blockquote:my-2`
- `variant === "compact"`:
  - `prose-sm`
  - 간격 override: `prose-headings:my-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1 prose-blockquote:my-1`
  - 글자 자체는 부모 버블이 이미 `text-sm`이므로 prose 크기는 동일 유지

체크포인트:
- 헤딩, 단락, 리스트, 코드 블록, 인용구가 chat 버블 안에서 자연스럽게 보이는지 시연 답변으로 확인.
- 리스트 들여쓰기와 단락 간격이 너무 크지 않은지 확인.

## 동작 정의

- 스트리밍: assistant content는 chunk 단위로 누적된다. 매 chunk마다 `MarkdownMessage`가 재파싱한다. 채팅 길이 규모(수백~수천 자)에서 성능 영향은 무시 가능 범위로 가정한다.
- 미완 마크다운: 코드 펜스가 닫히지 않은 중간 상태는 일시적으로 깨져 보일 수 있다(react-markdown 알려진 동작). 스트림 종료 후 정상 렌더링되면 허용한다.
- 원본 HTML: react-markdown 기본값(HTML 비활성) 유지. 추가 sanitize 라이브러리 없음.
- 사용자 메시지: 기존 평문 + `whitespace-pre-wrap` 그대로.

## 테스트

단위 테스트(Vitest): `frontend/src/components/chat/MarkdownMessage.test.tsx`

- 헤딩(`##`)이 `<h2>`로 렌더링되는지
- 굵게(`**bold**`)가 `<strong>`로 렌더링되는지
- 번호 리스트와 불릿 리스트가 `<ol>`/`<ul>`로 렌더링되는지
- 인라인 코드(`` ` ``)와 코드 블록(```` ``` ````)이 `<code>` / `<pre><code>`로 렌더링되는지
- 원본 HTML(`<script>` 등)이 무시되는지

수동 확인:
- Chat 페이지에서 시연용 예시 답변(헤딩 + 리스트 + 굵게 혼합)이 의도대로 렌더링되는지
- WidgetDemo의 compact 버블에서도 동일 콘텐츠가 답답하지 않게 렌더링되는지

## 파일 변경 요약

신규:
- `frontend/src/components/chat/MarkdownMessage.tsx`
- `frontend/src/components/chat/MarkdownMessage.test.tsx`

수정:
- `frontend/src/components/chat/ChatMessage.tsx` (assistant 분기 본문 1곳, ~6줄 교체)

## 작업 흐름

1. 본 설계 문서 커밋
2. 구현 계획 문서 작성(별도 단계)
3. `MarkdownMessage` 컴포넌트 + 단위 테스트 작성
4. `ChatMessage.tsx` 교체
5. 타입체크, 린트, 테스트 통과 확인
6. 수동 시연(Chat + WidgetDemo) 후 PR
