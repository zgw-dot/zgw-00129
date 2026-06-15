import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store';
import MainLayout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ContractsPage from './pages/ContractsPage';
import ClausesPage from './pages/ClausesPage';
import ClauseDetailPage from './pages/ClauseDetailPage';
import AuditLogsPage from './pages/AuditLogsPage';
import ImportGuidePage from './pages/ImportGuidePage';
import CountersignDetailPage from './pages/CountersignDetailPage';
import MyCountersignsPage from './pages/MyCountersignsPage';

function App() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/contracts" replace />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/contracts/:contractId/clauses" element={<ClausesPage />} />
        <Route path="/clauses/:clauseId" element={<ClauseDetailPage />} />
        <Route path="/my-countersigns" element={<MyCountersignsPage />} />
        <Route path="/countersigns/:roundId" element={<CountersignDetailPage />} />
        <Route path="/audit-logs" element={<AuditLogsPage />} />
        <Route path="/import-guide" element={<ImportGuidePage />} />
        <Route path="*" element={<Navigate to="/contracts" replace />} />
      </Routes>
    </MainLayout>
  );
}

export default App;
