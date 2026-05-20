import { createContext, useContext, useState, type ReactNode } from "react"

export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
}

interface AuthContextValue {
  user: AuthUser | null
  login: (email: string) => Promise<void>
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const USER_KEY = "docops_user"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem(USER_KEY)
    if (!stored) return null
    try {
      return JSON.parse(stored) as AuthUser
    } catch {
      localStorage.removeItem(USER_KEY)
      return null
    }
  })
  const isLoading = false

  const login = async (email: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "로그인 실패" }))
      throw new Error(err.detail || "로그인 실패")
    }
    const data: AuthUser = await res.json()
    localStorage.setItem(USER_KEY, JSON.stringify(data))
    setUser(data)
  }

  const logout = () => {
    localStorage.removeItem(USER_KEY)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
