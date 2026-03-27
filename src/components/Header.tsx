import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Header() {
  const { user, isAuthenticated, logout } = useAuth();
  const location = useLocation();

  const isActive = (path: string) =>
    location.pathname.startsWith(path) ? 'header-link active' : 'header-link';

  return (
    <header className="app-header">
      <div className="header-inner">
        <Link to="/folding/" className="header-brand">
          <span className="header-icon">P</span>
          <span className="header-title">Predict Structure</span>
        </Link>

        <nav className="header-nav">
          <Link to="/folding/submit" className={isActive('/folding/submit')}>Submit</Link>
          <Link to="/folding/jobs" className={isActive('/folding/jobs')}>Jobs</Link>
        </nav>

        <div className="header-user">
          {isAuthenticated ? (
            <>
              <span className="header-username">{user?.username}</span>
              <button className="btn-sm btn-outline" onClick={logout}>Logout</button>
            </>
          ) : (
            <Link to="/folding/login" className="btn-sm btn-primary">Login</Link>
          )}
        </div>
      </div>
    </header>
  );
}
