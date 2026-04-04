import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, useAuthProvider } from './hooks/useAuth';
import { SettingsContext, useSettingsProvider } from './hooks/useSettings';
import Header from './components/Header';
import SubmitPage from './pages/SubmitPage';
import JobPage from './pages/JobPage';
import JobsListPage from './pages/JobsListPage';
import LoginForm from './components/LoginForm';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function App() {
  const auth = useAuthProvider();
  const settings = useSettingsProvider();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth.value}>
        <SettingsContext.Provider value={settings.value}>
          <BrowserRouter>
            <Header />
            <div className="page">
              <Routes>
                <Route path="/folding/" element={<Navigate to="/folding/submit" replace />} />
                <Route path="/folding/submit" element={<SubmitPage />} />
                <Route path="/folding/jobs" element={<JobsListPage />} />
                <Route path="/folding/jobs/:id" element={<JobPage />} />
                <Route path="/folding/login" element={<LoginForm />} />
              </Routes>
            </div>
          </BrowserRouter>
        </SettingsContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}
