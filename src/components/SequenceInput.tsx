import { useState, useRef } from 'react';

type InputMethod = 'paste' | 'upload' | 'workspace';

interface Props {
  value: string;
  onChange: (seq: string) => void;
  onFileSelect: (file: File) => void;
  onWorkspaceSelect: () => void;
}

export default function SequenceInput({ value, onChange, onFileSelect, onWorkspaceSelect }: Props) {
  const [method, setMethod] = useState<InputMethod>('paste');
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <h2 className="section-title">Input Sequence</h2>
      <p className="section-sub">Upload a FASTA file or paste your sequence directly</p>

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
          placeholder={'>protein_name\nMASEQ...'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
        />
      )}

      {method === 'upload' && (
        <div
          className="drop-zone"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) onFileSelect(f);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".fasta,.fa,.yaml,.yml"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFileSelect(f);
            }}
          />
          <div className="drop-icon">+</div>
          <div>Drop .fasta, .fa, .yaml file here or <span className="link-text">browse</span></div>
        </div>
      )}

      {method === 'workspace' && (
        <div className="ws-select-row">
          <span className="ws-icon">&#128194;</span>
          <span className="ws-path">/user@bvbrc/home/StructurePrediction/</span>
          <button type="button" className="btn-sm btn-primary" onClick={onWorkspaceSelect}>
            Select File
          </button>
        </div>
      )}
    </div>
  );
}
