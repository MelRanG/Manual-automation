import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import type { JiraConfig, JiraCallbackLog } from "@/lib/api"

interface WebhookLog {
  id: string
  sr_draft_id: string
  target_url: string
  payload_summary: string
  response_status: number | null
  status: string
  created_at: string
}

export function WebhookLogs() {
  const [tab, setTab] = useState<"inbound" | "outbound">("inbound")

  // 설정
  const [config, setConfig] = useState<JiraConfig | null>(null)
  const [form, setForm] = useState({ base_url: "", user_email: "", api_token: "", project_key: "", trigger_status_names: "", is_active: true })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // 로그
  const [callbackLogs, setCallbackLogs] = useState<JiraCallbackLog[]>([])
  const [outboundLogs, setOutboundLogs] = useState<WebhookLog[]>([])
  const [retrying, setRetrying] = useState<string | null>(null)

  useEffect(() => {
    api.getJiraConfig().then(cfg => {
      if (cfg) {
        setConfig(cfg)
        setForm({
          base_url: cfg.base_url,
          user_email: cfg.user_email,
          api_token: "",
          project_key: cfg.project_key,
          trigger_status_names: (cfg.trigger_status_names ?? []).join(", "),
          is_active: cfg.is_active,
        })
      }
    }).catch(() => {})
    fetchLogs()
  }, [])

  const fetchLogs = () => {
    api.listJiraCallbackLogs().then(setCallbackLogs).catch(() => {})
    fetch('/api/sr/webhook-logs').then(r => r.json()).then(setOutboundLogs).catch(() => {})
  }

  const parseStatusNames = (): string[] | null => {
    const trimmed = form.trigger_status_names.trim()
    if (!trimmed) return null
    return trimmed.split(",").map(s => s.trim()).filter(Boolean)
  }

  const handleSave = async () => {
    setSaving(true)
    setTestResult(null)
    try {
      const cfg = await api.saveJiraConfig({
        base_url: form.base_url,
        user_email: form.user_email,
        api_token: form.api_token || config?.api_token_masked || "",
        project_key: form.project_key,
        is_active: form.is_active,
        trigger_status_names: parseStatusNames(),
      })
      setConfig(cfg)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.testJiraConfig({
        base_url: form.base_url,
        user_email: form.user_email,
        api_token: form.api_token || config?.api_token_masked || "",
        project_key: form.project_key,
        is_active: form.is_active,
        trigger_status_names: parseStatusNames(),
      })
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  const handleRetry = async (logId: string) => {
    setRetrying(logId)
    try {
      await fetch(`/api/sr/webhook-logs/${logId}/retry`, { method: 'POST' })
      fetchLogs()
    } finally {
      setRetrying(null)
    }
  }

  const getCallbackStatusStyle = (status: string) => {
    if (status === "processed") return "bg-[#d5e3fc] text-[#16a34a]"
    if (status === "skipped") return "bg-[#e6e8ea] text-[#444653]"
    return "bg-[#ffdad6] text-[#93000a]"
  }

  const getOutboundStatusStyle = (status: string) => {
    if (status === "delivered") return "bg-[#d5e3fc] text-[#16a34a]"
    if (status === "skipped") return "bg-[#e6e8ea] text-[#444653]"
    return "bg-[#ffdad6] text-[#93000a]"
  }

  const connectionStatus = config
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#d5e3fc] text-[#16a34a]"><span className="w-1.5 h-1.5 rounded-full bg-current" />연결됨</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#e6e8ea] text-[#444653]"><span className="w-1.5 h-1.5 rounded-full bg-current" />미설정</span>

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#191c1e]">Jira 연동 관리</h2>
          <p className="text-sm text-[#444653] mt-1">Jira 연동 설정 및 웹훅 이력을 관리합니다.</p>
        </div>
        <button onClick={fetchLogs} className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
          <span className="material-symbols-outlined text-base">refresh</span>
          새로고침
        </button>
      </div>

      {/* 설정 카드 */}
      <div className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#191c1e]">Jira 연동 설정</h3>
          {connectionStatus}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-xs font-medium text-[#444653] mb-1 block">Base URL</label>
            <input
              className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder="https://yourcompany.atlassian.net"
              value={form.base_url}
              onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#444653] mb-1 block">이메일</label>
            <input
              className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder="admin@yourcompany.com"
              value={form.user_email}
              onChange={e => setForm(f => ({ ...f, user_email: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#444653] mb-1 block">API 토큰</label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder={config ? config.api_token_masked : "API 토큰 입력"}
              value={form.api_token}
              onChange={e => setForm(f => ({ ...f, api_token: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#444653] mb-1 block">프로젝트 키</label>
            <input
              className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder="DOCOPS"
              value={form.project_key}
              onChange={e => setForm(f => ({ ...f, project_key: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#444653] mb-1 block">Done 트리거 상태명 <span className="text-[#757684] font-normal">(쉼표 구분, 비우면 done 카테고리 전체)</span></label>
            <input
              className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder="Done, 배포됨"
              value={form.trigger_status_names}
              onChange={e => setForm(f => ({ ...f, trigger_status_names: e.target.value }))}
            />
          </div>
        </div>

        {testResult && (
          <div className={`text-sm px-3 py-2 rounded-lg ${testResult.success ? "bg-[#d5e3fc] text-[#16a34a]" : "bg-[#ffdad6] text-[#93000a]"}`}>
            {testResult.message}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">
            {saving ? "저장 중..." : "저장"}
          </button>
          <button onClick={handleTest} disabled={testing} className="px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] disabled:opacity-50 transition-colors">
            {testing ? "테스트 중..." : "연결 테스트"}
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="border-b border-[#e0e3e5]">
        <div className="flex gap-1">
          {(["inbound", "outbound"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"}`}
            >
              {t === "inbound" ? "수신 로그 (Jira → DocOps)" : "전송 로그 (DocOps → Jira)"}
            </button>
          ))}
        </div>
      </div>

      {/* 수신 로그 */}
      {tab === "inbound" && (
        callbackLogs.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">webhook</span>
            <p className="mt-4 text-sm text-[#757684]">Jira에서 수신된 콜백이 없습니다</p>
          </div>
        ) : (
          <div className="bg-white border border-[#c4c5d5] rounded-xl overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e0e3e5] bg-[#f7f9fb]">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-[#444653]">이슈 키</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">이벤트</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">연결 SR</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">처리 결과</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">시간</th>
                </tr>
              </thead>
              <tbody>
                {callbackLogs.map(log => (
                  <tr key={log.id} className="border-b border-[#e0e3e5] last:border-0 hover:bg-[#f7f9fb] transition-colors">
                    <td className="px-6 py-3">
                      <span className="text-sm font-mono font-semibold text-[#00288e]">{log.jira_issue_key}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[#757684]">{log.event_type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[#757684] font-mono">{log.sr_draft_id ? log.sr_draft_id.slice(0, 8) + "..." : "-"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getCallbackStatusStyle(log.status)}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {log.status === "processed" ? "처리됨" : log.status === "skipped" ? "건너뜀" : log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#757684]">
                      {new Date(log.created_at).toLocaleString("ko-KR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* 전송 로그 */}
      {tab === "outbound" && (
        outboundLogs.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">webhook</span>
            <p className="mt-4 text-sm text-[#757684]">아직 웹훅 전송 기록이 없습니다</p>
          </div>
        ) : (
          <div className="bg-white border border-[#c4c5d5] rounded-xl overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e0e3e5] bg-[#f7f9fb]">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-[#444653]">내용</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">대상 URL</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">HTTP</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">상태</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">시간</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {outboundLogs.map(log => (
                  <tr key={log.id} className="border-b border-[#e0e3e5] last:border-0 hover:bg-[#f7f9fb] transition-colors">
                    <td className="px-6 py-3">
                      <p className="text-sm font-medium text-[#191c1e]">{log.payload_summary || "SR Delivery"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[#757684] font-mono truncate max-w-[200px] block">{log.target_url}</span>
                    </td>
                    <td className="px-4 py-3">
                      {log.response_status ? (
                        <span className={`text-xs font-semibold ${log.response_status < 400 ? "text-[#16a34a]" : "text-[#ba1a1a]"}`}>
                          {log.response_status}
                        </span>
                      ) : <span className="text-xs text-[#757684]">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getOutboundStatusStyle(log.status)}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {log.status === "delivered" ? "전송됨" : log.status === "skipped" ? "건너뜀" : "실패"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#757684]">
                      {new Date(log.created_at).toLocaleString("ko-KR")}
                    </td>
                    <td className="px-4 py-3">
                      {(log.status === "failed" || log.status === "error") && (
                        <button
                          onClick={() => handleRetry(log.id)}
                          disabled={retrying === log.id}
                          className="text-xs text-[#00288e] hover:text-[#1e40af] font-medium disabled:opacity-50"
                        >
                          {retrying === log.id ? "..." : "재시도"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
