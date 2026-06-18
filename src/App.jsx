import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import AppShell from './components/AppShell.jsx'
import { Spinner } from './components/ui.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Upload from './pages/Upload.jsx'
import Browse from './pages/Browse.jsx'
import DocumentView from './pages/DocumentView.jsx'
import Search from './pages/Search.jsx'
import Trips from './pages/Trips.jsx'
import Review from './pages/Review.jsx'
import Retention from './pages/Retention.jsx'
import Bonds from './pages/Bonds.jsx'
import Audit from './pages/Audit.jsx'
import Compliance from './pages/Compliance.jsx'
import ESign from './pages/ESign.jsx'
import Settings from './pages/Settings.jsx'
import NotFound from './pages/NotFound.jsx'

function Protected({ children }) {
  const { user, booting } = useAuth()
  const location = useLocation()
  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner className="w-8 h-8" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <AppShell>{children}</AppShell>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/upload" element={<Protected><Upload /></Protected>} />
      <Route path="/browse" element={<Protected><Browse /></Protected>} />
      <Route path="/document/:id" element={<Protected><DocumentView /></Protected>} />
      <Route path="/search" element={<Protected><Search /></Protected>} />
      <Route path="/trips" element={<Protected><Trips /></Protected>} />
      <Route path="/review" element={<Protected><Review /></Protected>} />
      <Route path="/retention" element={<Protected><Retention /></Protected>} />
      <Route path="/bonds" element={<Protected><Bonds /></Protected>} />
      <Route path="/audit" element={<Protected><Audit /></Protected>} />
      <Route path="/compliance" element={<Protected><Compliance /></Protected>} />
      <Route path="/esign" element={<Protected><ESign /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
