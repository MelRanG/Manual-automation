import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { api, type ManualJob } from "@/lib/api"

const STORAGE_KEY = "manual_running_job"

interface RunningJob {
  id: string
  targetUrl: string
  startedAt: string
}

interface ManualJobContextValue {
  runningJob: RunningJob | null
  currentStatus: ManualJob["status"] | null
  startJob: (job: ManualJob) => void
  clearJob: () => void
}

const ManualJobContext = createContext<ManualJobContextValue>({
  runningJob: null,
  currentStatus: null,
  startJob: () => {},
  clearJob: () => {},
})

export function ManualJobProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [runningJob, setRunningJob] = useState<RunningJob | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [currentStatus, setCurrentStatus] = useState<ManualJob["status"] | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearJob = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setRunningJob(null)
    setCurrentStatus(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const startPolling = useCallback((jobId: string) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(async () => {
      try {
        const updated = await api.getManualJob(jobId)
        setCurrentStatus(updated.status)
        if (updated.status === "completed") {
          clearJob()
          navigate("/approvals")
        } else if (updated.status === "failed") {
          clearJob()
        }
      } catch {
        // 일시적 오류 무시
      }
    }, 2000)
  }, [clearJob, navigate])

  const startJob = useCallback((job: ManualJob) => {
    const info: RunningJob = { id: job.id, targetUrl: job.target_url, startedAt: new Date().toISOString() }
    setRunningJob(info)
    setCurrentStatus("running")
    localStorage.setItem(STORAGE_KEY, JSON.stringify(info))
    startPolling(job.id)
  }, [startPolling])

  // 앱 재진입 시 저장된 job이 있으면 폴링 재개
  useEffect(() => {
    if (runningJob) {
      startPolling(runningJob.id)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // startPolling은 stable ref이므로 runningJob 변경 시에만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ManualJobContext.Provider value={{ runningJob, currentStatus, startJob, clearJob }}>
      {children}
    </ManualJobContext.Provider>
  )
}

export const useManualJob = () => useContext(ManualJobContext)
