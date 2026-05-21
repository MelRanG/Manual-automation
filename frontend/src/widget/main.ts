import { getWidgetStyles } from "./styles"
import { createSession, askStream, getMessages, type WidgetConfig, type WidgetMessage } from "./api"

/**
 * SECURITY: `data-user-id` is set by the host site and cannot be verified
 * by this widget. SR submission and feedback creation are intentionally NOT
 * exposed here until SSO/JWT verification is implemented end-to-end.
 * The React WidgetDemo (`/widget-demo`) is the safe surface for showcasing
 * authenticated features in the meantime.
 */

interface DocOpsWidgetGlobal {
  siteId?: string
  apiUrl?: string
  primaryColor?: string
  position?: "bottom-right" | "bottom-left"
}

declare global {
  interface Window {
    DocOpsWidget?: DocOpsWidgetGlobal
  }
}

function init() {
  const script = document.currentScript as HTMLScriptElement | null
  const globalConfig = window.DocOpsWidget || {}

  const config: WidgetConfig = {
    siteId: script?.dataset.siteId || globalConfig.siteId || "default",
    apiUrl: script?.dataset.apiUrl || globalConfig.apiUrl || window.location.origin,
    userId: script?.dataset.userId || null,
    primaryColor: script?.dataset.primaryColor || globalConfig.primaryColor || "#e94560",
    position: (script?.dataset.position || globalConfig.position || "bottom-right") as WidgetConfig["position"],
  }

  const host = document.createElement("div")
  host.id = "docops-widget-root"
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: "open" })

  const style = document.createElement("style")
  style.textContent = getWidgetStyles(config.primaryColor!)
  shadow.appendChild(style)

  const container = document.createElement("div")
  shadow.appendChild(container)

  new WidgetApp(container, config)
}

class WidgetApp {
  private container: HTMLElement
  private config: WidgetConfig
  private sessionId: string | null = null
  private messages: WidgetMessage[] = []
  private isOpen = false
  private isStreaming = false
  private isCreating = false
  private panel: HTMLElement | null = null
  private messagesEl: HTMLElement | null = null
  private inputEl: HTMLInputElement | null = null

  constructor(container: HTMLElement, config: WidgetConfig) {
    this.container = container
    this.config = config
    this.restoreSession()
    this.render()
  }

  private restoreSession() {
    const stored = localStorage.getItem(`docops_widget_${this.config.siteId}`)
    if (stored) {
      try {
        const { sessionId } = JSON.parse(stored)
        this.sessionId = sessionId
      } catch { /* ignore */ }
    }
  }

  private saveSession() {
    localStorage.setItem(
      `docops_widget_${this.config.siteId}`,
      JSON.stringify({ sessionId: this.sessionId })
    )
  }

  private render() {
    this.container.innerHTML = `
      <button class="docops-trigger" aria-label="채팅 열기">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>
      </button>
      <div class="docops-panel hidden">
        <div class="docops-header">
          <h3>DocOps AI 챗봇</h3>
          <button class="docops-close" aria-label="닫기">✕</button>
        </div>
        <div class="docops-messages"></div>
        <div class="docops-input-area">
          <input type="text" placeholder="메시지를 입력하세요..." />
          <button aria-label="전송" disabled>
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
    `

    const trigger = this.container.querySelector(".docops-trigger") as HTMLElement
    const close = this.container.querySelector(".docops-close") as HTMLElement
    this.panel = this.container.querySelector(".docops-panel") as HTMLElement
    this.messagesEl = this.container.querySelector(".docops-messages") as HTMLElement
    this.inputEl = this.container.querySelector(".docops-input-area input") as HTMLInputElement
    const sendBtn = this.container.querySelector(".docops-input-area button") as HTMLButtonElement

    trigger.addEventListener("click", () => this.toggle())
    close.addEventListener("click", () => this.toggle())

    this.inputEl.addEventListener("input", () => {
      sendBtn.disabled = !this.inputEl!.value.trim() || this.isStreaming
    })
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !sendBtn.disabled) this.send()
    })
    sendBtn.addEventListener("click", () => this.send())
  }

  private async toggle() {
    this.isOpen = !this.isOpen
    this.panel!.classList.toggle("hidden", !this.isOpen)

    if (!this.isOpen) return
    if (this.sessionId && this.messages.length === 0) {
      await this.loadHistory()
    } else if (!this.sessionId && this.messages.length === 0) {
      this.startDraft()
    }
  }

  private startDraft() {
    this.messages = []
    this.renderMessages()
    this.addBotMessage("안녕하세요! 무엇을 도와드릴까요?")
  }

  private async loadHistory() {
    if (!this.sessionId) return
    try {
      const msgs = await getMessages(this.config, this.sessionId)
      this.messages = msgs
      this.renderMessages()
      if (msgs.length === 0) {
        this.addBotMessage("안녕하세요! 무엇을 도와드릴까요?")
      }
    } catch {
      localStorage.removeItem(`docops_widget_${this.config.siteId}`)
      this.sessionId = null
      this.messages = []
      this.startDraft()
    }
  }

  private async send() {
    const question = this.inputEl!.value.trim()
    if (!question || this.isStreaming || this.isCreating) return

    if (!this.sessionId) {
      this.isCreating = true
      try {
        const anonymousId = localStorage.getItem(`docops_anon_${this.config.siteId}`)
          || Math.random().toString(36).slice(2, 10)
        localStorage.setItem(`docops_anon_${this.config.siteId}`, anonymousId)
        const session = await createSession(this.config, anonymousId)
        this.sessionId = session.id
        this.saveSession()
      } catch {
        this.addBotMessage("연결에 실패했습니다. 잠시 후 다시 시도해주세요.")
        this.isCreating = false
        return
      }
      this.isCreating = false
    }

    this.inputEl!.value = ""
    this.isStreaming = true
    this.messages.push({ id: "temp-user", role: "user", content: question })
    this.renderMessages()

    const streamMsg: WidgetMessage = { id: "temp-bot", role: "assistant", content: "" }
    this.messages.push(streamMsg)
    this.renderMessages()

    try {
      for await (const event of askStream(this.config, this.sessionId, question)) {
        if (event.type === "token") {
          streamMsg.content += event.token
          this.renderMessages()
        } else if (event.type === "citations") {
          streamMsg.citations = event.citations
          streamMsg.warnings = event.warnings
          this.renderMessages()
        } else if (event.type === "done") {
          streamMsg.id = event.messageId
        }
      }
    } catch {
      streamMsg.content = "죄송합니다, 응답 중 오류가 발생했습니다."
      this.renderMessages()
    }

    this.isStreaming = false
    this.renderMessages()
  }

  private addBotMessage(content: string) {
    this.messages.push({ id: `sys-${Date.now()}`, role: "assistant", content })
    this.renderMessages()
  }

  private renderMessages() {
    if (!this.messagesEl) return
    this.messagesEl.innerHTML = this.messages
      .map(m => {
        const citations = m.citations?.length
          ? `<div class="docops-citations">출처: ${m.citations.map(c => this.escapeHtml(c.document_title || "참고 문서")).join(", ")}</div>`
          : ""
        const warning = m.warnings?.length
          ? `<div class="docops-warning">${this.escapeHtml(m.warnings.map(w => w.title).join(", "))}</div>`
          : ""
        return `<div class="docops-msg ${m.role}">${this.escapeHtml(m.content)}${citations}</div>${warning}`
      })
      .join("")
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init)
} else {
  init()
}
