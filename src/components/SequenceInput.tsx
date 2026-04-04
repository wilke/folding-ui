import { useState, useRef } from 'react';

type InputMethod = 'paste' | 'upload' | 'workspace';

interface Props {
  value: string;
  onChange: (seq: string) => void;
  onFileSelect: (file: File) => void;
  onWorkspaceSelect: () => void;
  title?: string;
  subtitle?: string;
  accept?: string;
  placeholder?: string;
  dropHint?: string;
}

export default function SequenceInput({
  value, onChange, onFileSelect, onWorkspaceSelect,
  title, subtitle, accept, placeholder, dropHint,
}: Props) {
  const [method, setMethod] = useState<InputMethod>(
    value.startsWith('workspace://') ? 'workspace' : 'paste'
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);

  const wsPath = value.startsWith('workspace://') ? value.replace('workspace://', '') : null;
  const fileAccept = accept ?? '.fasta,.fa,.yaml,.yml';

  return (
    <div>
      <h2 className="section-title">{title ?? 'Input Sequence'}</h2>
      <p className="section-sub">{subtitle ?? 'Upload a FASTA file or paste your sequence directly'}</p>

      <div className="pills">
        {(['paste', 'upload', 'workspace'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`pill${method === m ? ' active' : ''}`}
            onClick={() => setMethod(m)}
          >
            {m === 'paste' ? 'Paste Sequence' : m === 'upload' ? 'Upload File' : 'From Workspace'}
          </button>
        ))}
      </div>

      {method === 'paste' && (
        <textarea
          className="seq-textarea"
          placeholder={placeholder ?? '>protein_name\nMASEQ...'}
          value={wsPath ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
        />
      )}

      {method === 'upload' && (
        <>
          <div
            className="drop-zone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) {
                setUploadedName(f.name);
                onFileSelect(f);
              }
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept={fileAccept}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setUploadedName(f.name);
                  onFileSelect(f);
                }
              }}
            />
            {uploadedName ? (
              <div>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{'\uD83D\uDCC4'}</div>
                <div><strong>{uploadedName}</strong> selected</div>
                <div style={{ marginTop: 4, fontSize: 11, color: '#94A3B8' }}>Click to change</div>
              </div>
            ) : (
              <div>
                <div className="drop-icon">+</div>
                <div>{dropHint ?? 'Drop .fasta, .fa, .yaml file here or'} <span className="link-text">browse</span></div>
              </div>
            )}
          </div>
        </>
      )}

      {method === 'workspace' && (
        <div className="ws-select-row">
          <span className="ws-icon">{'\uD83D\uDCC2'}</span>
          {wsPath ? (
            <span className="ws-path">{wsPath}</span>
          ) : (
            <span className="ws-path" style={{ color: '#94A3B8' }}>No file selected</span>
          )}
          <button type="button" className="btn-sm btn-primary" onClick={onWorkspaceSelect}>
            {wsPath ? 'Change' : 'Select File'}
          </button>
        </div>
      )}
    </div>
  );
}
