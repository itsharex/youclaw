import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { Chat } from './pages/Chat'
import { Agents } from './pages/Agents'
import { Memory } from './pages/Memory'
import { Tasks } from './pages/Tasks'
import { useTheme } from './hooks/useTheme'

// Tauri devUrl 是 http 协议，可以直接用 BrowserRouter
export default function App() {
  useTheme()

  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/cron" element={<Tasks />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  )
}
