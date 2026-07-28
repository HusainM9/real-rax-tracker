import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import RequireAccount from './components/RequireAccount'
import { AccountProvider } from './context/AccountAuthContext'
import { AuthProvider } from './context/AuthContext'
import { RaxDataProvider } from './context/RaxDataContext'
import CalendarPage from './pages/CalendarPage'
import CardsPage from './pages/CardsPage'
import DashboardPage from './pages/DashboardPage'
import EntryPage from './pages/EntryPage'
import HelpPage from './pages/HelpPage'
import LoginPage from './pages/LoginPage'
import AccountPage from './pages/AccountPage'
import OverlapsPage from './pages/OverlapsPage'
import PotentialPage from './pages/PotentialPage'
import PlanPage from './pages/PlanPage'
import PlanPacksPage from './pages/PlanPacksPage'
import SellPage from './pages/SellPage'
import AdminLoginPage from './pages/AdminLoginPage'
import AdminPage from './pages/AdminPage'
import RequireAdmin from './components/RequireAdmin'
import { AdminProvider } from './context/AdminAuthContext'
import './App.css'

function AccountScope() {
  return (
    <AccountProvider>
      <Outlet />
    </AccountProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AccountScope />}>
              <Route path="/account" element={<AccountPage />} />
              <Route element={<RequireAccount />}>
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
                  <Route path="/overlap" element={<OverlapsPage />} />
                  <Route path="/overlaps" element={<OverlapsPage />} />
                  <Route path="/potential" element={<PotentialPage />} />
                  <Route path="/plan" element={<PlanPage />} />
                  <Route path="/packs" element={<PlanPacksPage />} />
                  <Route path="/plan/packs" element={<Navigate to="/packs" replace />} />
                  <Route path="/cards" element={<CardsPage />} />
                  <Route path="/sell" element={<SellPage />} />
                  <Route path="/help" element={<HelpPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Route>
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
