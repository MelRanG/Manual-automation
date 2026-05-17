import { useState, useEffect, useCallback } from "react"
import type { Notification } from "@/lib/api"
import { api } from "@/lib/api"

export interface UseNotificationsResult {
  notifications: Notification[]
  unreadCount: number
  newNotification: Notification | null
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  clearNew: () => void
}

export function useNotifications(userId: string | undefined): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [newNotification, setNewNotification] = useState<Notification | null>(null)

  const loadNotifications = useCallback(async () => {
    if (!userId) return
    try {
      const data = await api.listNotifications()
      setNotifications(data)
    } catch {
      // 인증 실패 등 무시
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    loadNotifications()

    // SSE 연결 (커스텀 fetch 기반 구현 — 헤더 전송 가능)
    let active = true
    const controller = new AbortController()

    const connectSSE = async () => {
      try {
        const res = await fetch("/api/notifications/stream", {
          headers: { "X-User-Id": userId },
          signal: controller.signal,
        })
        if (!res.body || !active) return

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (active) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          let eventType = ""
          let dataLine = ""

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim()
            } else if (line.startsWith("data:")) {
              dataLine = line.slice(5).trim()
            } else if (line === "" && eventType === "notification" && dataLine) {
              try {
                const notif: Notification = JSON.parse(dataLine)
                setNotifications((prev) => [notif, ...prev])
                setNewNotification(notif)
              } catch {
                // ignore parse errors
              }
              eventType = ""
              dataLine = ""
            }
          }
        }
      } catch {
        // SSE 연결 끊김 — 재연결
        if (active) {
          setTimeout(connectSSE, 3000)
        }
      }
    }

    connectSSE()

    return () => {
      active = false
      controller.abort()
    }
  }, [userId, loadNotifications])

  const markRead = async (id: string) => {
    await api.markNotificationRead(id)
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    )
  }

  const markAllRead = async () => {
    await api.markAllNotificationsRead()
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
  }

  const clearNew = () => setNewNotification(null)

  const unreadCount = notifications.filter((n) => !n.is_read).length

  return { notifications, unreadCount, newNotification, markRead, markAllRead, clearNew }
}
