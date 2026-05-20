import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AuthProvider, useAuth } from "@/contexts/AuthContext"
import { ManualJobProvider } from "@/contexts/ManualJobContext"
import { Layout } from "@/components/Layout"
import { Login } from "@/pages/Login"
import { Dashboard } from "@/pages/Dashboard"
import { Documents } from "@/pages/Documents"
import { DocumentDetail } from "@/pages/DocumentDetail"
import { DocumentEdit } from "@/pages/DocumentEdit"
import { Chat } from "@/pages/Chat"
import { Feedback } from "@/pages/Feedback"
import { TrustScores } from "@/pages/TrustScores"
import { ServiceRequests } from "@/pages/ServiceRequests"
import { WebhookLogs } from "@/pages/WebhookLogs"
import { ManualGenerator } from "@/pages/ManualGenerator"
import { WidgetDemo } from "@/pages/WidgetDemo"
import { WidgetConversations } from "@/pages/WidgetConversations"

function ProtectedRoutes() {
  const { user, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f7f9fb] flex items-center justify-center">
        <div className="text-[#757684] text-sm">로딩 중...</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <Layout />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ManualJobProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/widget-demo" element={<WidgetDemo />} />
          <Route element={<ProtectedRoutes />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/documents/:id" element={<DocumentDetail />} />
            <Route path="/documents/:id/edit" element={<DocumentEdit />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/trust" element={<TrustScores />} />
            <Route path="/sr" element={<ServiceRequests />} />
            <Route path="/webhook-logs" element={<WebhookLogs />} />
            <Route path="/manuals" element={<ManualGenerator />} />
            <Route path="/widget-conversations" element={<WidgetConversations />} />
          </Route>
        </Routes>
        </ManualJobProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
