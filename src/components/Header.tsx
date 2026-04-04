import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSettings, type ColorScheme } from '../hooks/useSettings';

const SCHEMES: Array<{ id: ColorScheme; color: string; label: string }> = [
  { id: 'teal', color: '#00B4D8', label: 'Teal Science' },
  { id: 'cepi', color: '#FFCB5C', label: 'CEPI Heritage' },
];

export default function Header() {
  const { user, isAuthenticated, logout } = useAuth();
  const { workflowMode, setWorkflowMode, colorScheme, setColorScheme } = useSettings();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isActive = (path: string) =>
    location.pathname.startsWith(path) ? 'header-link active' : 'header-link';

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const handleCopyToken = useCallback(() => {
    if (!user?.token) return;
    navigator.clipboard.writeText(user.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [user?.token]);

  const truncatedToken = user?.token
    ? user.token.slice(0, 24) + '····'
    : null;

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

        {/* Settings dropdown */}
        <div className="settings-wrapper" ref={dropdownRef}>
          <button
            className="settings-trigger"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-haspopup="true"
          >
            {isAuthenticated && user ? (
              <>
                <span className="settings-trigger-user">{user.username}</span>
                <span className="settings-chevron">{open ? '▴' : '▾'}</span>
              </>
            ) : (
              <>
                <span className="settings-trigger-icon">⚙</span>
                <span className="settings-chevron">{open ? '▴' : '▾'}</span>
              </>
            )}
          </button>

          {open && (
            <div className="settings-dropdown">
              {/* Color scheme */}
              <div className="settings-section">
                <div className="settings-label">Color Scheme</div>
                <div className="settings-scheme-row">
                  {SCHEMES.map((s) => (
                    <button
                      key={s.id}
                      className={`settings-scheme-btn${colorScheme === s.id ? ' active' : ''}`}
                      onClick={() => setColorScheme(s.id)}
                    >
                      <span className="settings-scheme-dot" style={{ background: s.color }} />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Workflow mode */}
              <div className="settings-section">
                <div className="settings-label">Workflow Mode</div>
                <div className="settings-mode-row">
                  <button
                    className={`settings-mode-btn${workflowMode === 'unified' ? ' active' : ''}`}
                    onClick={() => setWorkflowMode('unified')}
                  >
                    Standard
                  </button>
                  <button
                    className={`settings-mode-btn${workflowMode === 'individual' ? ' active' : ''}`}
                    onClick={() => setWorkflowMode('individual')}
                  >
                    Expert
                  </button>
                </div>
                <div className="settings-hint">
                  {workflowMode === 'unified'
                    ? 'Unified predict-structure workflow with guided submission.'
                    : 'Individual tool workflows with full parameter control.'}
                </div>
              </div>

              {/* Token (when logged in) */}
              {isAuthenticated && user && (
                <div className="settings-section">
                  <div className="settings-label">Auth Token</div>
                  <div className="settings-token-row">
                    <code className="settings-token-value">{truncatedToken}</code>
                    <button className="settings-token-copy" onClick={handleCopyToken}>
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              {/* Login / Logout */}
              <div className="settings-section settings-section-footer">
                {isAuthenticated ? (
                  <button className="settings-logout-btn" onClick={() => { logout(); setOpen(false); }}>
                    Logout
                  </button>
                ) : (
                  <Link to="/folding/login" className="settings-login-btn" onClick={() => setOpen(false)}>
                    Login
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
