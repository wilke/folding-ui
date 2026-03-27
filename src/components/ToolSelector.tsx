const TOOLS = [
  { id: 'auto', name: 'Auto-Select', desc: 'Best tool based on input', icon: '\u2726' },
  { id: 'boltz', name: 'Boltz-2', desc: 'Diffusion-based, ligands & DNA/RNA', icon: '\u269B' },
  { id: 'chai', name: 'Chai-1', desc: 'Hybrid, strong multimer support', icon: '\uD83E\uDDEC' },
  { id: 'alphafold', name: 'AlphaFold 2', desc: 'Co-evolution, gold standard', icon: '\uD83D\uDD2C' },
  { id: 'esmfold', name: 'ESMFold', desc: 'Fast single-sequence, no MSA', icon: '\u26A1' },
] as const;

export type ToolId = (typeof TOOLS)[number]['id'];

interface Props {
  value: ToolId;
  onChange: (id: ToolId) => void;
}

export default function ToolSelector({ value, onChange }: Props) {
  return (
    <div className="tool-grid">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tool-card${value === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <div className="tool-card-icon">{t.icon}</div>
          <div className="tool-card-name">{t.name}</div>
          <div className="tool-card-desc">{t.desc}</div>
        </button>
      ))}
    </div>
  );
}

export { TOOLS };
