import { useState, useEffect, useCallback } from 'react';
import { wsLs, type WsObject } from '../api/workspace';
import { useAuth } from '../hooks/useAuth';

export type BrowseMode = 'file' | 'folder';

interface Props {
  open: boolean;
  mode?: BrowseMode;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function WorkspaceBrowser({ open, mode = 'file', initialPath, onSelect, onClose }: Props) {
  const { user, isAuthenticated } = useAuth();
  const homePath = user ? `/${user.username}/home/` : '/';
  const startPath = initialPath ?? homePath;

  const [currentPath, setCurrentPath] = useState(startPath);
  const [items, setItems] = useState<WsObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset path when dialog opens or user changes
  useEffect(() => {
    if (open) {
      setCurrentPath(initialPath ?? homePath);
    }
  }, [open, initialPath, homePath]);

  const loadDir = useCallback(async (path: string) => {
    if (!isAuthenticated) {
      setError('Please log in to browse workspace');
      return;
    }
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
  }, [isAuthenticated]);

  useEffect(() => {
    if (open && isAuthenticated) loadDir(currentPath);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const parentPath = currentPath.replace(/[^/]+\/$/, '');

  const isFolder = (item: WsObject) =>
    item.type === 'folder' || item.type === 'modelfolder' || !!item.autoMetadata?.is_folder;

  const handleItemClick = (item: WsObject) => {
    // item.path is the PARENT directory; full path = parent + name
    const fullPath = item.path.endsWith('/')
      ? `${item.path}${item.name}`
      : `${item.path}/${item.name}`;

    if (isFolder(item)) {
      loadDir(`${fullPath}/`);
    } else if (mode === 'file') {
      onSelect(fullPath);
    }
  };

  const handleSelectFolder = () => {
    onSelect(currentPath);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{mode === 'folder' ? 'Select Output Folder' : 'Select File'}</h3>
          <button className="btn-close" onClick={onClose}>&times;</button>
        </div>

        <div className="ws-breadcrumb">
          <code>{currentPath}</code>
        </div>

        {!isAuthenticated && (
          <div className="error-banner" style={{ margin: '8px 20px' }}>
            You must be logged in to browse the workspace.
          </div>
        )}

        {error && <div className="error-banner" style={{ margin: '8px 20px' }}>{error}</div>}

        <div className="ws-list">
          {parentPath && parentPath !== currentPath && (
            <div className="ws-item" onClick={() => loadDir(parentPath)}>
              <span className="ws-item-icon">{'\uD83D\uDCC2'}</span>
              <span className="ws-item-name">..</span>
              <span className="ws-item-meta"></span>
            </div>
          )}

          {loading ? (
            <div className="ws-loading">Loading...</div>
          ) : (
            items.map((item) => {
              const folder = isFolder(item);
              return (
                <div
                  key={item.path}
                  className={`ws-item${mode === 'file' && !folder ? ' ws-item-selectable' : ''}`}
                  onClick={() => handleItemClick(item)}
                >
                  <span className="ws-item-icon">
                    {folder ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
                  </span>
                  <span className="ws-item-name">{item.name}</span>
                  <span className="ws-item-type">{!folder ? item.type : ''}</span>
                  <span className="ws-item-meta">
                    {folder ? '' : formatSize(item.size)}
                  </span>
                </div>
              );
            })
          )}

          {!loading && items.length === 0 && !error && (
            <div className="ws-loading">Empty folder</div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          {mode === 'folder' && (
            <button className="btn-primary" onClick={handleSelectFolder} style={{ marginLeft: 8 }}>
              Select This Folder
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
