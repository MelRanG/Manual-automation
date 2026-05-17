import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileText } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setError("")
    setLoading(true)
    try {
      await login(email.trim())
      navigate("/")
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다")
    } finally {
      setLoading(false)
    }
  }

  const handleQuickLogin = async () => {
    setEmail("admin@docops.ai")
    setError("")
    setLoading(true)
    try {
      await login("admin@docops.ai")
      navigate("/")
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f9fb] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border border-[#c4c5d5] shadow-sm p-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-[#00288e] flex items-center justify-center">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#191c1e]">Manual Automation</h1>
              <p className="text-xs text-[#757684]">Enterprise Documentation Platform</p>
            </div>
          </div>

          <h2 className="text-center text-[#191c1e] text-lg font-semibold mb-1">
            로그인
          </h2>
          <p className="text-center text-sm text-[#757684] mb-6">
            이메일을 입력하면 바로 시작할 수 있습니다
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#444653] mb-1.5">
                이메일
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-3.5 py-2.5 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] placeholder:text-[#c4c5d5] focus:outline-none focus:border-[#00288e] focus:ring-2 focus:ring-[#00288e]/10 transition-colors"
                required
                disabled={loading}
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full py-2.5 px-4 bg-[#00288e] text-white text-sm font-semibold rounded-lg hover:bg-[#001f6e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>

          <div className="mt-4">
            <div className="relative flex items-center">
              <div className="flex-1 border-t border-[#e8e9ef]" />
              <span className="mx-3 text-xs text-[#757684]">또는</span>
              <div className="flex-1 border-t border-[#e8e9ef]" />
            </div>
          </div>

          <button
            onClick={handleQuickLogin}
            disabled={loading}
            className="mt-4 w-full py-2.5 px-4 border border-[#c4c5d5] text-[#444653] text-sm font-medium rounded-lg hover:bg-[#f7f9fb] disabled:opacity-50 transition-colors"
          >
            Demo Admin으로 바로 시작 (admin@docops.ai)
          </button>

          <p className="mt-5 text-center text-xs text-[#757684]">
            입력한 이메일로 계정이 자동 생성됩니다
          </p>
        </div>
      </div>
    </div>
  )
}
