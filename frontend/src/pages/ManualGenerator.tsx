import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { BookOpen, Plus, Loader2, ExternalLink, X } from "lucide-react"
import { Link } from "react-router-dom"
import { api } from "@/lib/api"
import type { ManualJob } from "@/lib/api"

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001"

export function ManualGenerator() {
  const [jobs, setJobs] = useState<ManualJob[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)

  const [targetUrl, setTargetUrl] = useState("")
  const [loginUrl, setLoginUrl] = useState("")
  const [loginId, setLoginId] = useState("")
  const [loginPw, setLoginPw] = useState("")
  const [steps, setSteps] = useState<string[]>([])
  const [stepInput, setStepInput] = useState("")

  const fetchJobs = () => {
    api.listManualJobs().then(setJobs).catch(() => {})
  }

  useEffect(() => { fetchJobs() }, [])

  useEffect(() => {
    if (jobs.some(j => j.status === "pending" || j.status === "running")) {
      const interval = setInterval(fetchJobs, 3000)
      return () => clearInterval(interval)
    }
  }, [jobs])

  const handleSubmit = async () => {
    if (!targetUrl.trim()) return
    setLoading(true)
    try {
      await api.createManualJob({
        user_id: DEMO_USER_ID,
        target_url: targetUrl.trim(),
        login_id: loginId || undefined,
        login_pw: loginPw || undefined,
        login_url: loginUrl || undefined,
        scenario_steps: steps.length > 0 ? steps : undefined,
      })
      setShowForm(false)
      setTargetUrl("")
      setLoginUrl("")
      setLoginId("")
      setLoginPw("")
      setSteps([])
      fetchJobs()
    } finally {
      setLoading(false)
    }
  }

  const addStep = () => {
    if (stepInput.trim()) {
      setSteps([...steps, stepInput.trim()])
      setStepInput("")
    }
  }

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index))
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge variant="success">완료</Badge>
      case "running": return <Badge variant="secondary">생성 중...</Badge>
      case "pending": return <Badge variant="secondary">대기</Badge>
      case "failed": return <Badge variant="destructive">실패</Badge>
      default: return <Badge>{status}</Badge>
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">사용자 매뉴얼 생성</h2>
          <p className="text-muted-foreground mt-1">
            웹사이트 URL을 입력하면 Playwright로 캡처 후 AI가 매뉴얼을 자동 생성합니다
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4" /> 새 매뉴얼 생성
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <label className="text-sm font-medium">대상 URL *</label>
              <Input
                placeholder="https://example.com"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">로그인 URL (선택)</label>
                <Input
                  placeholder="https://example.com/login"
                  value={loginUrl}
                  onChange={(e) => setLoginUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">로그인 ID (선택)</label>
                <Input
                  placeholder="user@email.com"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">로그인 PW (선택)</label>
                <Input
                  type="password"
                  placeholder="••••••"
                  value={loginPw}
                  onChange={(e) => setLoginPw(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">시나리오 단계 (선택)</label>
              <p className="text-xs text-muted-foreground mb-2">
                캡처할 페이지 이동 단계를 추가하세요. 비워두면 메인 페이지만 캡처합니다.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="예: 마이페이지 클릭"
                  value={stepInput}
                  onChange={(e) => setStepInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addStep()}
                />
                <Button variant="outline" onClick={addStep} type="button">추가</Button>
              </div>
              {steps.length > 0 && (
                <div className="mt-2 space-y-1">
                  {steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm bg-muted px-3 py-1.5 rounded">
                      <span className="text-muted-foreground">{i + 1}.</span>
                      <span className="flex-1">{step}</span>
                      <button onClick={() => removeStep(i)} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>취소</Button>
              <Button onClick={handleSubmit} disabled={loading || !targetUrl.trim()}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                매뉴얼 생성 시작
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {jobs.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen className="h-16 w-16 mx-auto text-muted-foreground/30" />
          <p className="mt-4 text-muted-foreground">아직 생성된 매뉴얼이 없습니다</p>
          <p className="text-sm text-muted-foreground mt-1">
            "새 매뉴얼 생성" 버튼을 눌러 시작하세요
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Card key={job.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{job.target_url}</p>
                      {statusBadge(job.status)}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {new Date(job.created_at).toLocaleString("ko-KR")}
                      </span>
                      {job.login_url && (
                        <span className="text-xs text-muted-foreground">로그인: {job.login_url}</span>
                      )}
                      {job.screenshots && (
                        <span className="text-xs text-muted-foreground">
                          스크린샷 {job.screenshots.length}장
                        </span>
                      )}
                    </div>
                    {job.error_message && (
                      <p className="text-xs text-destructive mt-1">{job.error_message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {job.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    {job.output_document_id && (
                      <Link to={`/documents/${job.output_document_id}`}>
                        <Button size="sm" variant="outline">
                          <ExternalLink className="h-3 w-3" /> 문서 보기
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
