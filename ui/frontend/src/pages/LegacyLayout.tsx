// Step-1 stub pages with their original top bar. Removed once the dashboard tabs exist.
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import HistoryPage from './HistoryPage';
import LivePage from './LivePage';
import PatientsPage from './PatientsPage';
import './legacy.css';

export default function LegacyLayout() {
  return (
    <div className="legacy">
      <header className="topbar">
        <span className="brand">Wrist Exo (step 1 stubs)</span>
        <nav>
          <NavLink to="/old/patients">Patients</NavLink>
          <NavLink to="/old/live">Live</NavLink>
          <NavLink to="/old/history">History</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="patients" element={<PatientsPage />} />
          <Route path="live" element={<LivePage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="*" element={<Navigate to="patients" replace />} />
        </Routes>
      </main>
    </div>
  );
}
