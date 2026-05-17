import { parseSSE } from './sse'

const BASE = '/api'

function getAuthHeaders(): Record<string, string> {
  const stored = localStorage.getItem('docops_user')
  if (!stored) return {}
  try {
    const user = JSON.parse(stored)
    return user?.id ? { 'X-User-Id': user.id } : {}
  } catch {
    return {}
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

export interface StreamEvent {
  type: 'token' | 'citations' | 'done'
  token?: string
  citations?: Citation[]
  warnings?: DocumentWarning[]
  messageId?: string
}

async function* askStream(path: string, question: string): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw new Error('Stream request failed')

  for await (const event of parseSSE(res)) {
    if (event.event === 'token') {
      const { token } = JSON.parse(event.data)
      yield { type: 'token', token }
    } else if (event.event === 'citations') {
      const data = JSON.parse(event.data)
      yield { type: 'citations', citations: data.citations, warnings: data.warnings }
    } else if (event.event === 'done') {
      const { message_id } = JSON.parse(event.data)
      yield { type: 'done', messageId: message_id }
    }
  }
}

export const api = {
  // Users
  createUser: (data: { name: string; email: string; role?: string }) =>
    request<User>('/users', { method: 'POST', body: JSON.stringify(data) }),
  listUsers: () => request<User[]>('/users'),

  // Documents
  listDocuments: (skip = 0, limit = 20) =>
    request<{ documents: Document[]; total: number }>(`/documents?skip=${skip}&limit=${limit}`),
  getDocument: (id: string) => request<Document>(`/documents/${id}`),
  getVersions: (id: string) => request<DocumentVersion[]>(`/documents/${id}/versions`),
  createDocument: (data: { title: string; description?: string; owner_id?: string }, content: string) =>
    request<Document>(`/documents?content=${encodeURIComponent(content)}`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  uploadDocument: (form: FormData) =>
    fetch(`${BASE}/documents/upload`, { method: 'POST', body: form }).then(r => r.json()),

  // Chat
  createSession: (userId: string, title?: string) =>
    request<ChatSession>('/chat/sessions', { method: 'POST', body: JSON.stringify({ user_id: userId, title }) }),
  listSessions: (userId: string) => request<ChatSession[]>(`/chat/sessions?user_id=${userId}`),
  getMessages: (sessionId: string) => request<ChatMessage[]>(`/chat/sessions/${sessionId}/messages`),
  deleteSession: (sessionId: string) =>
    fetch(`${BASE}/chat/sessions/${sessionId}`, { method: 'DELETE', headers: getAuthHeaders() }),
  askQuestion: (sessionId: string, question: string) =>
    request<AskResponse>(`/chat/sessions/${sessionId}/ask`, {
      method: 'POST', body: JSON.stringify({ question }),
    }),
  askQuestionStream: (sessionId: string, question: string) =>
    askStream(`/chat/sessions/${sessionId}/ask-stream`, question),

  // Feedback
  createFeedback: (data: { user_id: string; document_id?: string; chat_message_id?: string; feedback_text: string }) =>
    request<{ feedback: FeedbackReport; proposed_change: ProposedChange | null }>('/feedback', {
      method: 'POST', body: JSON.stringify(data),
    }),
  listFeedback: (documentId?: string) =>
    request<FeedbackReport[]>(`/feedback${documentId ? `?document_id=${documentId}` : ''}`),
  deleteFeedback: (id: string) =>
    fetch(`${BASE}/feedback/${id}`, { method: 'DELETE', headers: getAuthHeaders() }),

  // Approvals
  createApproval: (proposedChangeId: string) =>
    request<ApprovalRequest>(`/approvals/${proposedChangeId}`, { method: 'POST' }),
  listApprovals: () => request<ApprovalRequest[]>('/approvals'),
  reviewApproval: (id: string, data: { reviewer_id: string; action: string; comment?: string; edited_content?: string }) =>
    request<ApprovalRequest>(`/approvals/${id}/review`, { method: 'POST', body: JSON.stringify(data) }),

  // Trust
  listTrustScores: () => request<TrustScore[]>('/trust'),
  recalculateTrust: (documentId: string) =>
    request<{ document_id: string; trust_score: number }>(`/trust/${documentId}/recalculate`, { method: 'POST' }),

  // SR
  listSRDrafts: (userId?: string) =>
    request<SRDraft[]>(`/sr/drafts${userId ? `?user_id=${userId}` : ''}`),
  createSRDraft: (data: { user_id: string; title: string; description: string; priority: string }) =>
    request<SRDraft>('/sr/drafts', { method: 'POST', body: JSON.stringify(data) }),
  generateSR: (data: { user_id: string; document_id: string; issue_description: string }) =>
    request<SRDraft>('/sr/generate', { method: 'POST', body: JSON.stringify(data) }),
  submitSR: (id: string) =>
    request<{ sr_id: string; status: string; webhook: { status: string } }>(`/sr/drafts/${id}/submit`, { method: 'POST' }),

  // Change Impact
  analyzeImpact: (data: { source_type: string; source_id: string; related_document_ids?: string[] }) =>
    request<ImpactAnalysis>('/change-impact/analyze', { method: 'POST', body: JSON.stringify(data) }),
  listAnalyses: () => request<ImpactAnalysis[]>('/change-impact'),

  // Manual Generation
  createManualJob: (data: { user_id: string; target_url: string; login_id?: string; login_pw?: string; login_url?: string; scenario_steps?: string[]; source_sr_id?: string }) =>
    request<ManualJob>('/manuals/jobs', { method: 'POST', body: JSON.stringify(data) }),
  listManualJobs: (userId?: string) =>
    request<ManualJob[]>(`/manuals/jobs${userId ? `?user_id=${userId}` : ''}`),
  getManualJob: (id: string) => request<ManualJob>(`/manuals/jobs/${id}`),

  // Notifications
  listNotifications: () => request<Notification[]>('/notifications'),
  markNotificationRead: (id: string) =>
    request<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    request<{ ok: boolean }>('/notifications/read-all', { method: 'POST' }),
}

// Types
export interface User { id: string; name: string; email: string; role: string; department: string | null; created_at: string }
export interface Document { id: string; title: string; description: string | null; owner_id: string | null; status: string; priority: string; trust_score: number; view_count: number; created_at: string; updated_at: string; current_version_id: string | null }
export interface DocumentVersion { id: string; document_id: string; version_number: number; content: string; source_file_url: string | null; change_summary: string | null; created_at: string }
export interface ChatSession { id: string; user_id: string; title: string | null; created_at: string }
export interface ChatMessage { id: string; session_id: string; role: string; content: string; created_at: string }
export interface AskResponse { message_id: string; content: string; citations: Citation[]; warnings?: DocumentWarning[] }
export interface DocumentWarning { document_id: string; title: string; reason: "trust_score_low" | "stale" }
export interface Citation { document_id: string; document_title: string; quote: string; chunk_id: string }
export interface FeedbackReport { id: string; user_id: string; document_id: string | null; feedback_text: string; status: string; created_at: string }
export interface ProposedChange { id: string; feedback_report_id: string; document_id: string; original_text: string; proposed_text: string; diff: string; reasoning: string; confidence: number; status: string }
export interface ApprovalRequest { id: string; proposed_change_id: string; reviewer_id: string | null; status: string; comment: string | null; reviewed_at: string | null; created_at: string }
export interface TrustScore { id: string; title: string; trust_score: number }
export interface SRDraft { id: string; user_id: string; title: string; description: string; priority: string; status: string; created_by_ai: boolean; created_at: string }
export interface ImpactAnalysis { id: string; source_type: string; source_id: string; recommended_strategy: string; reasoning: string; confidence: number; status: string; created_at: string }
export interface ManualJob { id: string; user_id: string; target_url: string; login_url: string | null; status: string; output_document_id: string | null; screenshots: { step: number; filename: string | null; url: string; description: string }[] | null; error_message: string | null; created_at: string }
export interface Notification { id: string; type: string; title: string; message: string; document_id: string | null; is_read: boolean; created_at: string }
