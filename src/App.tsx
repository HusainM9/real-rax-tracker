import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AdminProvider } from './context/AdminAuthContext'
import { AccountProvider } from './context/AccountAuthContext'
import { AuthProvider } from './context/AuthContext'
import { RaxDataProvider } from './context/RaxDataContext'
import Layout from './components/Layout'
import RequireAccount from './components/RequireAccount'
import RequireAdmin from './components/RequireAdmin'
import RequireAuth from './components/RequireAuth'
import RequireEarnings from './components/RequireEarnings'
import './App.css'
import './UIRefresh.css'

const AccountPage = lazy(() => import('./pages/AccountPage'))
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const CardsPage = lazy(() => import('./pages/CardsPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const MarketplaceAlertsPage = lazy(() => import('./pages/MarketplaceAlertsPage'))
const OtdPage = lazy(() => import('./pages/OtdPage'))
const OverlapsPage = lazy(() => import('./pages/OverlapsPage'))
const PlanPacksPage = lazy(() => import('./pages/PlanPacksPage'))
const PlanPage = lazy(() => import('./pages/PlanPage'))
const OptimizationPage = lazy(() => import('./pages/OptimizationPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const SellPage = lazy(() => import('./pages/SellPage'))
const PreviewPerformancePage = import.meta.env.VITE_PREVIEW_PERF_LAB === '1'
  ? lazy(() => import('./pages/PreviewPerformancePage')) : null

function AccountScope() {
  return (
    <AccountProvider>
      <Outlet />
    </AccountProvider>
  )
}

function TrackerLayout() {
  return (
    <RaxDataProvider>
      <Layout />
    </RaxDataProvider>
  )
}

function LegacyEntryRedirect() {
  const location = useLocation()
  return <Navigate to={`/?import=1${location.hash}`} replace />
}

function RouteLoadingFallback() {
  return <main className="page-shell">Loading…</main>
}

function createAdminRoutes() {
  return (
    <>
      {/* Admin only needs site password + admin password — not a user account. */}
      <Route path="/admin/login" element={<AdminProvider><AdminLoginPage /></AdminProvider>} />
      <Route element={<AdminProvider><RequireAdmin /></AdminProvider>}>
        <Route path="/admin" element={<AdminPage />} />
      </Route>
    </>
  )
}

function createAccountRoutes() {
  return (
    <Route element={<AccountScope />}>
      <Route path="/account" element={<AccountPage />} />
      <Route element={<RequireAccount />}>
        {PreviewPerformancePage ? <Route path="/performance-check" element={<PreviewPerformancePage />} /> : null}
        <Route element={<TrackerLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/entry" element={<LegacyEntryRedirect />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/otd" element={<OtdPage />} />
          <Route path="/overlap" element={<OverlapsPage />} />
          <Route path="/overlaps" element={<OverlapsPage />} />
          <Route path="/potential" element={<OptimizationPage />} />
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
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/earnings" element={<Navigate to="/" replace />} />
            <Route path="/earnings/access" element={<Navigate to="/" replace />} />
            <Route element={<RequireAuth />}>
              {createAdminRoutes()}
              {createAccountRoutes()}
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
