import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import RequireAccount from './components/RequireAccount'
import RequireEarnings from './components/RequireEarnings'
import { AccountProvider } from './context/AccountAuthContext'
import { AuthProvider } from './context/AuthContext'
import { RaxDataProvider } from './context/RaxDataContext'
import RequireAdmin from './components/RequireAdmin'
import { AdminProvider } from './context/AdminAuthContext'
import './App.css'

const AccountPage = lazy(() => import('./pages/AccountPage'))
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const CardsPage = lazy(() => import('./pages/CardsPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const EntryPage = lazy(() => import('./pages/EntryPage'))
const EarningsPage = lazy(() => import('./pages/EarningsPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const MarketplaceAlertsPage = lazy(() => import('./pages/MarketplaceAlertsPage'))
const OtdPage = lazy(() => import('./pages/OtdPage'))
const OverlapsPage = lazy(() => import('./pages/OverlapsPage'))
const PlanPacksPage = lazy(() => import('./pages/PlanPacksPage'))
const PlanPage = lazy(() => import('./pages/PlanPage'))
const PotentialPage = lazy(() => import('./pages/PotentialPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const SellPage = lazy(() => import('./pages/SellPage'))

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
        <Suspense fallback={<main className="page-shell">Loading…</main>}>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/earnings/access" element={<Navigate to="/earnings" replace />} />
          <Route element={<AccountScope />}>
            <Route
              element={
                <RaxDataProvider>
                  <Layout />
                </RaxDataProvider>
              }
            >
              <Route path="/earnings" element={<RequireEarnings><EarningsPage /></RequireEarnings>} />
            </Route>
          </Route>
          <Route element={<RequireAuth />}>
            {/* Admin only needs site password + admin password — not a user account */}
            <Route path="/admin/login" element={<AdminProvider><AdminLoginPage /></AdminProvider>} />
            <Route element={<AdminProvider><RequireAdmin /></AdminProvider>}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>

            <Route element={<AccountScope />}>
              <Route path="/account" element={<AccountPage />} />
              <Route element={<RequireAccount />}>
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
                  <Route path="/packs" element={<PlanPacksPage />} />
                  <Route path="/plan/packs" element={<Navigate to="/packs" replace />} />
                  <Route path="/cards" element={<CardsPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/marketplace" element={<RequireEarnings feature="marketplace"><MarketplaceAlertsPage /></RequireEarnings>} />
                  <Route path="/sell" element={<SellPage />} />
                  <Route path="/help" element={<HelpPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Route>
            </Route>
          </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
