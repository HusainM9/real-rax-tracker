import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import { AuthProvider } from './context/AuthContext'
import { RaxDataProvider } from './context/RaxDataContext'
import CalendarPage from './pages/CalendarPage'
import CardsPage from './pages/CardsPage'
import DashboardPage from './pages/DashboardPage'
import EntryPage from './pages/EntryPage'
import HelpPage from './pages/HelpPage'
import LoginPage from './pages/LoginPage'
import OtdPage from './pages/OtdPage'
import OverlapsPage from './pages/OverlapsPage'
import PotentialPage from './pages/PotentialPage'
import PlanPage from './pages/PlanPage'
import SellPage from './pages/SellPage'
import AdminLoginPage from './pages/AdminLoginPage'
import AdminPage from './pages/AdminPage'
import RequireAdmin from './components/RequireAdmin'
import { AdminProvider } from './context/AdminAuthContext'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/admin/login" element={<AdminProvider><AdminLoginPage /></AdminProvider>} />
            <Route element={<AdminProvider><RequireAdmin /></AdminProvider>}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
            <Route
              element={
                <RaxDataProvider>
                  <Layout />
                </RaxDataProvider>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/entry" element={<EntryPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/otd" element={<OtdPage />} />
              <Route path="/overlap" element={<OverlapsPage />} />
              <Route path="/overlaps" element={<OverlapsPage />} />
              <Route path="/potential" element={<PotentialPage />} />
              <Route path="/plan" element={<PlanPage />} />
              <Route path="/cards" element={<CardsPage />} />
              <Route path="/sell" element={<SellPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
