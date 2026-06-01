import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { RaxDataProvider } from './context/RaxDataContext'
import CalendarPage from './pages/CalendarPage'
import CardsPage from './pages/CardsPage'
import DashboardPage from './pages/DashboardPage'
import EntryPage from './pages/EntryPage'
import HelpPage from './pages/HelpPage'
import OverlapsPage from './pages/OverlapsPage'
import PotentialPage from './pages/PotentialPage'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <RaxDataProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/entry" element={<EntryPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/overlap" element={<OverlapsPage />} />
            <Route path="/overlaps" element={<OverlapsPage />} />
            <Route path="/potential" element={<PotentialPage />} />
            <Route path="/cards" element={<CardsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </RaxDataProvider>
    </BrowserRouter>
  )
}
