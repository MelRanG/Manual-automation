import { useApi } from "@/hooks/useApi"
import { api, type ChangeHistory } from "@/lib/api"

const EVENT_LABELS: Record<string, string> = {
  created: "생성",
  ai_draft: "AI 초안",
  edited: "수정",
  status_changed: "상태 변경",
  approved: "승인",
  applied: "문서 반영",
  rejected: "반려",
}

const EVENT_COLORS: Record<string, string> = {
  created: "bg-[#e8f4fd] text-[#00288e]",
  ai_draft: "bg-[#f0f0ff] text-[#4a4bdc]",
  edited: "bg-[#fff3dc] text-[#92600a]",
  status_changed: "bg-[#f2f4f6] text-[#444653]",
  approved: "bg-[#dcfce7] text-[#15803d]",
  applied: "bg-[#dcfce7] text-[#15803d]",
  rejected: "bg-[#ffdad6] text-[#ba1a1a]",
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

interface Props {
  entityType: "sr" | "feedback" | "manual"
  entityId: string
  events?: ChangeHistory[] | null
  loading?: boolean
}

export function ChangeHistoryTimeline({ entityType, entityId, events: externalEvents, loading: externalLoading }: Props) {
  const useExternal = externalEvents !== undefined
  const { data: fetchedEvents, loading: fetchedLoading, error } = useApi<ChangeHistory[]>(
    () => useExternal ? Promise.resolve(externalEvents ?? []) : api.listHistory(entityType, entityId),
    [entityType, entityId, useExternal]
  )

  const events = useExternal ? (externalEvents ?? []) : (fetchedEvents ?? [])
  const loading = externalLoading !== undefined ? externalLoading : fetchedLoading

  if (loading) {
    return <div className="text-xs text-[#757684] py-4">이력 로딩 중...</div>
  }

  if (!useExternal && error) {
    return <p className="text-sm text-red-500 px-4">이력을 불러오지 못했습니다.</p>
  }

  if (events.length === 0) {
    return <div className="text-xs text-[#757684] py-4">이력이 없습니다.</div>
  }

  return (
    <div className="space-y-0">
      {events.map((ev, i) => (
        <div key={ev.id} className="flex gap-3 relative">
          {i < events.length - 1 && (
            <div className="absolute left-[11px] top-6 bottom-0 w-px bg-[#e0e3e5]" />
          )}
          <div className="mt-1 w-6 h-6 rounded-full bg-[#f2f4f6] border border-[#e0e3e5] flex items-center justify-center shrink-0 z-10">
            <div className="w-2 h-2 rounded-full bg-[#9a9bad]" />
          </div>
          <div className="pb-4 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${EVENT_COLORS[ev.event_type] ?? "bg-[#f2f4f6] text-[#444653]"}`}>
                {EVENT_LABELS[ev.event_type] ?? ev.event_type}
              </span>
              {ev.actor_name && (
                <span className="text-xs text-[#444653] font-medium">{ev.actor_name}</span>
              )}
              <span className="text-[11px] text-[#9a9bad]">{formatDate(ev.created_at)}</span>
            </div>
            {ev.detail && (
              <p className="text-xs text-[#757684] mt-1">{ev.detail}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
