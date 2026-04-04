import { useState, useRef } from 'react';

// ── Types ────────────────────────────────────────────────

export interface FileEntry {
  id: string;
  name: string;
  source: 'upload' | 'workspace' | 'paste';
  content?: string;     // raw FASTA text (paste)
  file?: File;          // uploaded File object
  wsPath?: string;      // workspace path
}

export interface EntityInputs {
  proteins: FileEntry[];   // additional protein chains (beyond primary)
  dnas: FileEntry[];
  rnas: FileEntry[];
  ligands: string[];
  smiles: string[];
  glycans: string[];
}

export const EMPTY_ENTITIES: EntityInputs = {
  proteins: [],
  dnas: [],
  rnas: [],
  ligands: [],
  smiles: [],
  glycans: [],
};

// ── Helpers ──────────────────────────────────────────────

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Create a FileEntry from a workspace path selection. */
export function wsPathToFileEntry(path: string): FileEntry {
  return {
    id: genId(),
    name: path.split('/').pop() || 'file',
    source: 'workspace',
    wsPath: path,
  };
}

// ── Sub-components ───────────────────────────────────────

/** Section for file-based entity inputs (protein, DNA, RNA). */
function FileEntitySection({
  label,
  hint,
  accept,
  entries,
  entityKey,
  onAdd,
  onRemove,
  onBrowse,
}: {
  label: string;
  hint: string;
  accept: string;
  entries: FileEntry[];
  entityKey: string;
  onAdd: (entry: FileEntry) => void;
  onRemove: (id: string) => void;
  onBrowse: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const handleFileUpload = (file: File) => {
    onAdd({ id: genId(), name: file.name, source: 'upload', file });
  };

  const handlePasteAdd = () => {
    if (!pasteText.trim()) return;
    const firstLine = pasteText.trim().split('\n')[0] ?? '';
    const name = firstLine.startsWith('>')
      ? (firstLine.slice(1).trim().split(/\s/)[0] || `${entityKey}_seq`)
      : `${entityKey}_seq`;
    onAdd({ id: genId(), name: `${name}.fasta`, source: 'paste', content: pasteText });
    setPasteText('');
    setPasteOpen(false);
  };

  return (
    <div className="entity-section">
      <div className="entity-section-header">
        <span className="entity-section-label">{label}</span>
        <span className="entity-section-hint">{hint}</span>
      </div>

      {entries.length > 0 && (
        <div className="entity-chips">
          {entries.map((e) => (
            <div key={e.id} className="entity-chip">
              <span className="entity-chip-icon">
                {e.source === 'workspace' ? '\uD83D\uDCC2' : e.source === 'upload' ? '\uD83D\uDCC4' : '\uD83D\uDCDD'}
              </span>
              <span className="entity-chip-name">{e.name}</span>
              <button type="button" className="entity-chip-remove" onClick={() => onRemove(e.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {pasteOpen && (
        <div style={{ marginBottom: 8 }}>
          <textarea
            className="seq-textarea"
            style={{ height: 80, fontSize: 12 }}
            placeholder={`>sequence_name\nACGT...`}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button type="button" className="btn-outline btn-sm" onClick={handlePasteAdd}>
              Add
            </button>
            <button
              type="button"
              className="btn-outline btn-sm"
              onClick={() => { setPasteOpen(false); setPasteText(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="entity-actions">
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f);
            e.target.value = '';
          }}
        />
        <button type="button" className="btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
          Upload File
        </button>
        <button type="button" className="btn-outline btn-sm" onClick={onBrowse}>
          From Workspace
        </button>
        {!pasteOpen && (
          <button type="button" className="btn-outline btn-sm" onClick={() => setPasteOpen(true)}>
            Paste Sequence
          </button>
        )}
      </div>
    </div>
  );
}

/** Section for string-based entity inputs (ligand, SMILES, glycan). */
function StringEntitySection({
  label,
  hint,
  placeholder,
  entries,
  onAdd,
  onRemove,
}: {
  label: string;
  hint: string;
  placeholder: string;
  entries: string[];
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const val = input.trim();
    if (!val) return;
    onAdd(val);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="entity-section">
      <div className="entity-section-header">
        <span className="entity-section-label">{label}</span>
        <span className="entity-section-hint">{hint}</span>
      </div>

      {entries.length > 0 && (
        <div className="entity-chips">
          {entries.map((v, i) => (
            <div key={`${v}-${i}`} className="entity-chip entity-chip-string">
              <span className="entity-chip-name mono">{v}</span>
              <button type="button" className="entity-chip-remove" onClick={() => onRemove(i)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          className="field-input"
          style={{ flex: 1 }}
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="button" className="btn-outline btn-sm" onClick={handleAdd}>
          Add
        </button>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────

interface Props {
  value: EntityInputs;
  onChange: (entities: EntityInputs) => void;
  onBrowseWorkspace: (type: 'dna' | 'rna') => void;
  defaultOpen?: boolean;
}

export default function EntityInputPanel({ value, onChange, onBrowseWorkspace, defaultOpen }: Props) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  const totalCount =
    value.dnas.length + value.rnas.length +
    value.ligands.length + value.smiles.length + value.glycans.length;

  const addFile = (key: 'proteins' | 'dnas' | 'rnas') => (entry: FileEntry) =>
    onChange({ ...value, [key]: [...value[key], entry] });

  const removeFile = (key: 'proteins' | 'dnas' | 'rnas') => (id: string) =>
    onChange({ ...value, [key]: value[key].filter((e) => e.id !== id) });

  const addString = (key: 'ligands' | 'smiles' | 'glycans') => (val: string) =>
    onChange({ ...value, [key]: [...value[key], val] });

  const removeString = (key: 'ligands' | 'smiles' | 'glycans') => (index: number) =>
    onChange({ ...value, [key]: value[key].filter((_, i) => i !== index) });

  return (
    <div style={{ marginTop: 20 }}>
      <button type="button" className="link-btn" onClick={() => setOpen(!open)}>
        <span
          style={{
            display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        >
          &#9654;
        </span>{' '}
        Additional Molecular Entities
        {totalCount > 0 && (
          <span className="badge b-blue" style={{ marginLeft: 8, fontSize: 11 }}>
            {totalCount} added
          </span>
        )}
      </button>
      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4, marginLeft: 18 }}>
        Add DNA, RNA, ligands, SMILES, or glycans for complex assemblies
      </div>

      {open && (
        <div className="entity-panel">
          <FileEntitySection
            label="DNA Sequences"
            hint="DNA FASTA files"
            accept=".fasta,.fa,.fna"
            entries={value.dnas}
            entityKey="dna"
            onAdd={addFile('dnas')}
            onRemove={removeFile('dnas')}
            onBrowse={() => onBrowseWorkspace('dna')}
          />
          <FileEntitySection
            label="RNA Sequences"
            hint="RNA FASTA files"
            accept=".fasta,.fa,.fna"
            entries={value.rnas}
            entityKey="rna"
            onAdd={addFile('rnas')}
            onRemove={removeFile('rnas')}
            onBrowse={() => onBrowseWorkspace('rna')}
          />
          <StringEntitySection
            label="Ligands"
            hint="CCD codes (e.g. ATP, GTP, HEM)"
            placeholder="Enter CCD code..."
            entries={value.ligands}
            onAdd={addString('ligands')}
            onRemove={removeString('ligands')}
          />
          <StringEntitySection
            label="SMILES"
            hint="Small molecule SMILES strings"
            placeholder="Enter SMILES string..."
            entries={value.smiles}
            onAdd={addString('smiles')}
            onRemove={removeString('smiles')}
          />
          <StringEntitySection
            label="Glycans"
            hint="Glycan identifiers"
            placeholder="Enter glycan identifier..."
            entries={value.glycans}
            onAdd={addString('glycans')}
            onRemove={removeString('glycans')}
          />
        </div>
      )}
    </div>
  );
}
