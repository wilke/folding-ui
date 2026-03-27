import { useState, useEffect, useCallback } from 'react';
import { wsLs, type WsObject } from '../api/workspace';

interface Props {
  open: boolean;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function WorkspaceBrowser({ open, initialPath, onSelect, onClose }: Props) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? '/');
  const [items, setItems] = useState<WsObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await wsLs(path);
      setItems(result);
      setCurrentPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadDir(currentPath);
  }, [open, loadDir, currentPath]);

  if (!open) return null;

  const parentPath = currentPath.replace(/\/[^/]+\/?$/, '/');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Browse Workspace</h3>
          <button className="btn-close" onClick={onClose}>&times;</button>
        </div>

        <div className="ws-breadcrumb">
          <code>{currentPath}</code>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="ws-list">
          {currentPath !== '/' && (
            <div className="ws-item" onClick={() => loadDir(parentPath)}>
              <span className="ws-item-icon">&#128193;</span>
              <span>..</span>
            </div>
          )}

          {loading ? (
            <div className="ws-loading">Loading...</div>
          ) : (
            items.map((item) => (
              <div
                key={item.path}
                className="ws-item"
                onClick={() => {
                  if (item.type === 'folder') {
                    loadDir(item.path.endsWith('/') ? item.path : `${item.path}/`);
                  } else {
                    onSelect(item.path);
                  }
                }}
              >
                <span className="ws-item-icon">
                  {item.type === 'folder' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
                </span>
                <span className="ws-item-name">{item.name}</span>
                <span className="ws-item-meta">
                  {item.type === 'folder' ? '' : formatSize(item.size)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
