import { useState, useEffect } from "react"

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
  const [logs, setLogs] = useState<WebhookLog[]>([])
  const [retrying, setRetrying] = useState<string | null>(null)

  const fetchLogs = () => {
    fetch('/api/sr/webhook-logs').then(r => r.json()).then(setLogs).catch(() => {})
  }

  useEffect(() => { fetchLogs() }, [])

  const handleRetry = async (logId: string) => {
    setRetrying(logId)
    try {
      await fetch(`/api/sr/webhook-logs/${logId}/retry`, { method: 'POST' })
      fetchLogs()
    } finally {
      setRetrying(null)
    }
  }

  const getStatusStyle = (status: string) => {
    if (status === "delivered") return "bg-[#d5e3fc] text-[#16a34a]"
    if (status === "skipped") return "bg-[#e6e8ea] text-[#444653]"
    return "bg-[#ffdad6] text-[#93000a]"
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#191c1e]">웹훅 로그</h2>
          <p className="text-sm text-[#444653] mt-1">Jira 웹훅 전송 이력을 확인합니다.</p>
        </div>
        <button onClick={fetchLogs} className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
          <span className="material-symbols-outlined text-base">refresh</span>
          새로고침
        </button>
      </div>

      {logs.length === 0 ? (
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
              {logs.map((log) => (
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
                    ) : (
                      <span className="text-xs text-[#757684]">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusStyle(log.status)}`}>
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
      )}
    </div>
  )
}
