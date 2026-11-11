import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, currentUser } from './lib/auth';
import CapturePage from './pages/Capture';
import Dashboard from './pages/Dashboard';
import Connect from './pages/start/Connect';
import SignIn from './pages/start/SignIn';
import StartLayout from './pages/start/StartLayout';

// /signin    fake sign in            (arc draws in once, shared with /connect)
// /capture   class-demo capture: participants, live angle + EMG, Record/Stop (default after sign in)
// /connect   sensor checks, then /dashboard
// /dashboard PT dashboard: patients, Session / History / Profile (mock data)
export default function App() {
  return (
    <Routes>
      <Route element={<StartLayout />}>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/connect" element={<RequireAuth><Connect /></RequireAuth>} />
      </Route>
      <Route path="/capture" element={<RequireAuth><CapturePage /></RequireAuth>} />
      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="*" element={<Navigate to={currentUser() ? '/capture' : '/signin'} replace />} />
    </Routes>
  );
}
