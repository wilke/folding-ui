import { useState, useRef } from 'react';

/* ================================================================
   Types — matches Boltz YAML input schema
   ================================================================ */

export interface ProteinEntity {
  id: string;
  sequence: string;
  msaMode: 'auto' | 'empty';
  cyclic: boolean;
  modifications: { position: string; ccd: string }[];
}

export interface LigandEntity {
  id: string;
  inputType: 'ccd' | 'smiles';
  ccd: string;
  smiles: string;
}

export interface BondConstraint {
  atom1Chain: string; atom1Res: string; atom1Atom: string;
  atom2Chain: string; atom2Res: string; atom2Atom: string;
}

export interface PocketConstraint {
  binder: string;
  contacts: { chain: string; residue: string }[];
  maxDistance: string;
  force: boolean;
}

export interface ContactConstraint {
  token1Chain: string; token1Res: string;
  token2Chain: string; token2Res: string;
  maxDistance: string;
  force: boolean;
}

export interface BoltzInputState {
  proteins: ProteinEntity[];
  ligands: LigandEntity[];
  bonds: BondConstraint[];
  pockets: PocketConstraint[];
  contacts: ContactConstraint[];
}

/* ================================================================
   Defaults & helpers
   ================================================================ */

function makeProtein(id: string, sequence = ''): ProteinEntity {
  return { id, sequence, msaMode: 'auto', cyclic: false, modifications: [] };
}

function makeLigand(id: string): LigandEntity {
  return { id, inputType: 'ccd', ccd: '', smiles: '' };
}

function nextChainId(proteins: ProteinEntity[], ligands: LigandEntity[]): string {
  const used = new Set([...proteins.map((p) => p.id), ...ligands.map((l) => l.id)]);
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i);
    if (!used.has(id)) return id;
  }
  return 'X';
}

export const EMPTY_BOLTZ_INPUT: BoltzInputState = {
  proteins: [makeProtein('A')],
  ligands: [],
  bonds: [],
  pockets: [],
  contacts: [],
};

/* ================================================================
   YAML generation
   ================================================================ */

/** Strip FASTA headers and whitespace from a raw sequence. */
function cleanSequence(raw: string): string {
  return raw
    .split('\n')
    .filter((l) => !l.startsWith('>'))
    .join('')
    .replace(/\s/g, '');
}

export function generateBoltzYaml(state: BoltzInputState): string {
  const lines: string[] = ['version: 1', 'sequences:'];

  for (const p of state.proteins) {
    const seq = cleanSequence(p.sequence);
    if (!seq) continue;
    lines.push('  - protein:');
    lines.push(`      id: ${p.id}`);
    lines.push(`      sequence: ${seq}`);
    if (p.msaMode === 'empty') {
      lines.push('      msa: empty');
    }
    if (p.cyclic) lines.push('      cyclic: true');
    if (p.modifications.length > 0) {
      const validMods = p.modifications.filter((m) => m.position && m.ccd);
      if (validMods.length > 0) {
        lines.push('      modifications:');
        for (const mod of validMods) {
          lines.push(`        - position: ${mod.position}`);
          lines.push(`          ccd: ${mod.ccd}`);
        }
      }
    }
  }

  for (const l of state.ligands) {
    if (l.inputType === 'ccd' && !l.ccd) continue;
    if (l.inputType === 'smiles' && !l.smiles) continue;
    lines.push('  - ligand:');
    lines.push(`      id: ${l.id}`);
    if (l.inputType === 'ccd') {
      lines.push(`      ccd: ${l.ccd}`);
    } else {
      lines.push(`      smiles: '${l.smiles}'`);
    }
  }

  const hasConstraints =
    state.bonds.length > 0 || state.pockets.length > 0 || state.contacts.length > 0;
  if (hasConstraints) {
    lines.push('constraints:');
    for (const b of state.bonds) {
      if (!b.atom1Res || !b.atom1Atom || !b.atom2Res || !b.atom2Atom) continue;
      lines.push('  - bond:');
      lines.push(`      atom1: [${b.atom1Chain}, ${b.atom1Res}, ${b.atom1Atom}]`);
      lines.push(`      atom2: [${b.atom2Chain}, ${b.atom2Res}, ${b.atom2Atom}]`);
    }
    for (const pk of state.pockets) {
      if (!pk.binder) continue;
      const validContacts = pk.contacts.filter((c) => c.chain && c.residue);
      if (validContacts.length === 0) continue;
      lines.push('  - pocket:');
      lines.push(`      binder: ${pk.binder}`);
      lines.push('      contacts:');
      for (const c of validContacts) {
        lines.push(`        - [${c.chain}, ${c.residue}]`);
      }
      if (pk.maxDistance && pk.maxDistance !== '6.0') {
        lines.push(`      max_distance: ${pk.maxDistance}`);
      }
      if (pk.force) lines.push('      force: true');
    }
    for (const ct of state.contacts) {
      if (!ct.token1Res || !ct.token2Res) continue;
      lines.push('  - contact:');
      lines.push(`      token1: [${ct.token1Chain}, ${ct.token1Res}]`);
      lines.push(`      token2: [${ct.token2Chain}, ${ct.token2Res}]`);
      if (ct.maxDistance && ct.maxDistance !== '6.0') {
        lines.push(`      max_distance: ${ct.maxDistance}`);
      }
      if (ct.force) lines.push('      force: true');
    }
  }

  return lines.join('\n') + '\n';
}

/** Returns true if any protein uses auto MSA mode (not single-sequence). */
export function needsMsa(state: BoltzInputState): boolean {
  return state.proteins.some((p) => p.msaMode === 'auto');
}

/* ================================================================
   Inline Tip
   ================================================================ */

function Tip({ text }: { text: string }) {
  return (
    <span className="field-tip">
      <span className="field-tip-icon">&#9432;</span>
      <span className="field-tip-text">{text}</span>
    </span>
  );
}

/* ================================================================
   Component
   ================================================================ */

interface Props {
  value: BoltzInputState;
  onChange: (state: BoltzInputState) => void;
}

export default function BoltzInputBuilder({ value, onChange }: Props) {
  const [constraintsOpen, setConstraintsOpen] = useState(false);
  const [yamlOpen, setYamlOpen] = useState(false);

  /* ── Protein helpers ── */
  const setProtein = (idx: number, patch: Partial<ProteinEntity>) =>
    onChange({
      ...value,
      proteins: value.proteins.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    });

  const addProtein = () =>
    onChange({
      ...value,
      proteins: [...value.proteins, makeProtein(nextChainId(value.proteins, value.ligands))],
    });

  const removeProtein = (idx: number) =>
    onChange({ ...value, proteins: value.proteins.filter((_, i) => i !== idx) });

  /* ── Ligand helpers ── */
  const setLigand = (idx: number, patch: Partial<LigandEntity>) =>
    onChange({
      ...value,
      ligands: value.ligands.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    });

  const addLigand = () =>
    onChange({
      ...value,
      ligands: [...value.ligands, makeLigand(nextChainId(value.proteins, value.ligands))],
    });

  const removeLigand = (idx: number) =>
    onChange({ ...value, ligands: value.ligands.filter((_, i) => i !== idx) });

  /* ── Modification helpers ── */
  const addModification = (protIdx: number) => {
    const p = value.proteins[protIdx];
    if (!p) return;
    setProtein(protIdx, { modifications: [...p.modifications, { position: '', ccd: '' }] });
  };

  const setModification = (
    protIdx: number,
    modIdx: number,
    patch: Partial<{ position: string; ccd: string }>,
  ) => {
    const p = value.proteins[protIdx];
    if (!p) return;
    const mods = p.modifications.map((m, i) => (i === modIdx ? { ...m, ...patch } : m));
    setProtein(protIdx, { modifications: mods });
  };

  const removeModification = (protIdx: number, modIdx: number) => {
    const p = value.proteins[protIdx];
    if (!p) return;
    setProtein(protIdx, { modifications: p.modifications.filter((_, i) => i !== modIdx) });
  };

  /* ── Constraint helpers ── */
  const addBond = () =>
    onChange({
      ...value,
      bonds: [
        ...value.bonds,
        { atom1Chain: 'A', atom1Res: '', atom1Atom: '', atom2Chain: 'B', atom2Res: '', atom2Atom: '' },
      ],
    });

  const setBond = (idx: number, patch: Partial<BondConstraint>) =>
    onChange({ ...value, bonds: value.bonds.map((b, i) => (i === idx ? { ...b, ...patch } : b)) });

  const removeBond = (idx: number) =>
    onChange({ ...value, bonds: value.bonds.filter((_, i) => i !== idx) });

  const addPocket = () =>
    onChange({
      ...value,
      pockets: [
        ...value.pockets,
        { binder: '', contacts: [{ chain: 'A', residue: '' }], maxDistance: '6.0', force: false },
      ],
    });

  const setPocket = (idx: number, patch: Partial<PocketConstraint>) =>
    onChange({ ...value, pockets: value.pockets.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });

  const removePocket = (idx: number) =>
    onChange({ ...value, pockets: value.pockets.filter((_, i) => i !== idx) });

  const addContact = () =>
    onChange({
      ...value,
      contacts: [
        ...value.contacts,
        { token1Chain: 'A', token1Res: '', token2Chain: 'B', token2Res: '', maxDistance: '6.0', force: false },
      ],
    });

  const setContact = (idx: number, patch: Partial<ContactConstraint>) =>
    onChange({ ...value, contacts: value.contacts.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });

  const removeContact = (idx: number) =>
    onChange({ ...value, contacts: value.contacts.filter((_, i) => i !== idx) });

  const constraintCount = value.bonds.length + value.pockets.length + value.contacts.length;

  /* =============================================== */
  /* RENDER                                          */
  /* =============================================== */

  return (
    <div>
      <h2 className="section-title">Molecular Entities</h2>
      <p className="section-sub">
        Define proteins, ligands, and other molecules for structure prediction
      </p>

      {/* ── Protein entity cards ── */}
      {value.proteins.map((prot, pi) => (
        <ProteinCard
          key={prot.id}
          protein={prot}
          index={pi}
          canRemove={value.proteins.length > 1}
          onChange={(patch) => setProtein(pi, patch)}
          onRemove={() => removeProtein(pi)}
          onAddMod={() => addModification(pi)}
          onSetMod={(mi, patch) => setModification(pi, mi, patch)}
          onRemoveMod={(mi) => removeModification(pi, mi)}
        />
      ))}

      {/* ── Ligand entity cards ── */}
      {value.ligands.map((lig, li) => (
        <LigandCard
          key={lig.id}
          ligand={lig}
          index={li}
          onChange={(patch) => setLigand(li, patch)}
          onRemove={() => removeLigand(li)}
        />
      ))}

      {/* ── Add entity buttons ── */}
      <div className="entity-actions">
        <button type="button" className="btn-add-entity" onClick={addProtein}>
          + Add Protein
        </button>
        <button type="button" className="btn-add-entity" onClick={addLigand}>
          + Add Ligand
        </button>
      </div>

      {/* ── Structural Constraints (collapsible) ── */}
      <div style={{ marginTop: 24 }}>
        <button type="button" className="link-btn" onClick={() => setConstraintsOpen(!constraintsOpen)}>
          <span style={{ display: 'inline-block', transform: constraintsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
            &#9654;
          </span>{' '}
          Structural Constraints
          {constraintCount > 0 && (
            <span className="badge b-blue" style={{ marginLeft: 8, fontSize: 10 }}>
              {constraintCount}
            </span>
          )}
        </button>

        {constraintsOpen && (
          <div className="adv-panel" style={{ marginTop: 12 }}>
            {/* ── Bonds ── */}
            <ConstraintSection
              title="Covalent Bonds"
              tip="Define covalent bonds between atoms across different chains (e.g., disulfide bridges, covalent inhibitors)."
              onAdd={addBond}
              empty={value.bonds.length === 0}
            >
              {value.bonds.map((b, bi) => (
                <div key={bi} className="constraint-row">
                  <span className="constraint-label">Atom 1:</span>
                  <input className="field-input constraint-sm" placeholder="Chain" value={b.atom1Chain}
                    onChange={(e) => setBond(bi, { atom1Chain: e.target.value })} />
                  <input className="field-input constraint-sm" placeholder="Res#" type="number" value={b.atom1Res}
                    onChange={(e) => setBond(bi, { atom1Res: e.target.value })} />
                  <input className="field-input constraint-sm" placeholder="Atom" value={b.atom1Atom}
                    onChange={(e) => setBond(bi, { atom1Atom: e.target.value })} />
                  <span className="constraint-sep">&harr;</span>
                  <span className="constraint-label">Atom 2:</span>
                  <input className="field-input constraint-sm" placeholder="Chain" value={b.atom2Chain}
                    onChange={(e) => setBond(bi, { atom2Chain: e.target.value })} />
                  <input className="field-input constraint-sm" placeholder="Res#" type="number" value={b.atom2Res}
                    onChange={(e) => setBond(bi, { atom2Res: e.target.value })} />
                  <input className="field-input constraint-sm" placeholder="Atom" value={b.atom2Atom}
                    onChange={(e) => setBond(bi, { atom2Atom: e.target.value })} />
                  <button type="button" className="btn-remove-sm" onClick={() => removeBond(bi)}>&times;</button>
                </div>
              ))}
            </ConstraintSection>

            {/* ── Pockets ── */}
            <ConstraintSection
              title="Binding Pockets"
              tip="Guide a ligand to a specific binding pocket on a protein. Requires --use_potentials when force is enabled."
              onAdd={addPocket}
              empty={value.pockets.length === 0}
            >
              {value.pockets.map((pk, pi) => (
                <div key={pi} className="constraint-block">
                  <div className="constraint-row">
                    <span className="constraint-label">Binder:</span>
                    <input className="field-input constraint-sm" placeholder="Chain" value={pk.binder}
                      onChange={(e) => setPocket(pi, { binder: e.target.value })} />
                    <span className="constraint-label" style={{ marginLeft: 8 }}>Max dist (&Aring;):</span>
                    <input className="field-input constraint-sm" type="number" step="0.5" value={pk.maxDistance}
                      onChange={(e) => setPocket(pi, { maxDistance: e.target.value })} />
                    <label className="constraint-check">
                      <input type="checkbox" checked={pk.force}
                        onChange={(e) => setPocket(pi, { force: e.target.checked })} />
                      Force
                    </label>
                    <button type="button" className="btn-remove-sm" onClick={() => removePocket(pi)}>&times;</button>
                  </div>
                  <div style={{ marginLeft: 20, marginTop: 6 }}>
                    <span className="constraint-label" style={{ fontSize: 11 }}>Contact residues:</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {pk.contacts.map((c, ci) => (
                        <span key={ci} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <input className="field-input constraint-xs" placeholder="Ch" value={c.chain}
                            onChange={(e) => {
                              const contacts = [...pk.contacts];
                              contacts[ci] = { ...c, chain: e.target.value };
                              setPocket(pi, { contacts });
                            }} />
                          <input className="field-input constraint-xs" placeholder="Res" type="number" value={c.residue}
                            onChange={(e) => {
                              const contacts = [...pk.contacts];
                              contacts[ci] = { ...c, residue: e.target.value };
                              setPocket(pi, { contacts });
                            }} />
                          <button type="button" className="btn-remove-xs"
                            onClick={() => setPocket(pi, { contacts: pk.contacts.filter((_, i) => i !== ci) })}>&times;</button>
                        </span>
                      ))}
                      <button type="button" className="link-btn" style={{ fontSize: 11 }}
                        onClick={() => setPocket(pi, { contacts: [...pk.contacts, { chain: 'A', residue: '' }] })}>+ add</button>
                    </div>
                  </div>
                </div>
              ))}
            </ConstraintSection>

            {/* ── Contacts ── */}
            <ConstraintSection
              title="Distance Contacts"
              tip="Force two residues to be in close proximity. Useful for known interfaces, crosslinking data, or mutagenesis results."
              onAdd={addContact}
              empty={value.contacts.length === 0}
              last
            >
              {value.contacts.map((ct, ci) => (
                <div key={ci} className="constraint-row">
                  <span className="constraint-label">Token 1:</span>
                  <input className="field-input constraint-sm" placeholder="Chain" value={ct.token1Chain}
                    onChange={(e) => setContact(ci, { token1Chain: e.target.value })} />
                  <input className="field-input constraint-sm" placeholder="Res#" type="number" value={ct.token1Res}
                    onChange={(e) => setContact(ci, { token1Res: e.target.value })} />
                  <span className="constraint-sep">&harr;</span>
                  <span className="constraint-label">Token 2:</span>
                  <input className="field-input constraint-sm" placeholder="Chain" value={ct.token2Chain}
                    onChange={(e) => setContact(ci, { token2Chain: e.target.value })} />
                  <input className="field-input constraint-sm" placeholder="Res#" type="number" value={ct.token2Res}
                    onChange={(e) => setContact(ci, { token2Res: e.target.value })} />
                  <span className="constraint-label" style={{ marginLeft: 8 }}>Dist:</span>
                  <input className="field-input constraint-xs" type="number" step="0.5" value={ct.maxDistance}
                    onChange={(e) => setContact(ci, { maxDistance: e.target.value })} />
                  <label className="constraint-check">
                    <input type="checkbox" checked={ct.force}
                      onChange={(e) => setContact(ci, { force: e.target.checked })} />
                    Force
                  </label>
                  <button type="button" className="btn-remove-sm" onClick={() => removeContact(ci)}>&times;</button>
                </div>
              ))}
            </ConstraintSection>
          </div>
        )}
      </div>

      {/* ── YAML Preview (collapsible) ── */}
      <div style={{ marginTop: 16 }}>
        <button type="button" className="link-btn" onClick={() => setYamlOpen(!yamlOpen)}>
          <span style={{ display: 'inline-block', transform: yamlOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
            &#9654;
          </span>{' '}
          Preview YAML
        </button>
        {yamlOpen && (
          <pre className="yaml-preview">{generateBoltzYaml(value)}</pre>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   Protein Card
   ================================================================ */

interface ProteinCardProps {
  protein: ProteinEntity;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<ProteinEntity>) => void;
  onRemove: () => void;
  onAddMod: () => void;
  onSetMod: (modIdx: number, patch: Partial<{ position: string; ccd: string }>) => void;
  onRemoveMod: (modIdx: number) => void;
}

function ProteinCard({ protein, index, canRemove, onChange, onRemove, onAddMod, onSetMod, onRemoveMod }: ProteinCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const seqLen = cleanSequence(protein.sequence).length;

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onChange({ sequence: reader.result });
    };
    reader.readAsText(file);
  };

  return (
    <div className="boltz-entity-card">
      <div className="boltz-entity-header">
        <span className="boltz-entity-badge boltz-badge-protein">Protein</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label className="field-label" style={{ margin: 0, fontSize: 11 }}>Chain ID</label>
          <input
            className="field-input boltz-chain-id"
            maxLength={2}
            value={protein.id}
            onChange={(e) => onChange({ id: e.target.value.toUpperCase() })}
          />
        </div>
        {seqLen > 0 && <span className="boltz-seq-len">{seqLen} aa</span>}
        <div style={{ flex: 1 }} />
        {canRemove && (
          <button type="button" className="btn-remove-sm" title="Remove" onClick={onRemove}>&times;</button>
        )}
      </div>

      {/* Sequence */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label className="field-label" style={{ margin: 0 }}>
            Amino Acid Sequence{' '}
            <Tip text="Paste raw sequence or FASTA format. Headers are stripped automatically." />
          </label>
          <button type="button" className="link-btn" style={{ fontSize: 11 }} onClick={() => fileRef.current?.click()}>
            Upload file
          </button>
          <input ref={fileRef} type="file" accept=".fasta,.fa,.txt" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
        <textarea
          className="seq-textarea"
          style={{ height: 80, fontSize: 12 }}
          placeholder={'>protein_name\nMKVLWAALLVTFLAGCQA...'}
          value={protein.sequence}
          onChange={(e) => onChange({ sequence: e.target.value })}
        />
      </div>

      {/* MSA mode */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <label className="field-label" style={{ margin: 0, minWidth: 32 }}>
          MSA <Tip text="Multiple Sequence Alignment. 'Use MSA' expects pre-computed MSA files. 'None' runs single-sequence mode (faster, less accurate)." />
        </label>
        <label className="boltz-radio">
          <input type="radio" name={`msa-${index}`} checked={protein.msaMode === 'auto'}
            onChange={() => onChange({ msaMode: 'auto' })} />
          Use MSA
        </label>
        <label className="boltz-radio">
          <input type="radio" name={`msa-${index}`} checked={protein.msaMode === 'empty'}
            onChange={() => onChange({ msaMode: 'empty' })} />
          None (single-sequence)
        </label>
      </div>

      {/* Cyclic + Modifications */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <label className="field-check" style={{ padding: 0 }}>
          <input type="checkbox" checked={protein.cyclic}
            onChange={(e) => onChange({ cyclic: e.target.checked })} />
          <span className="field-check-label" style={{ fontSize: 12 }}>
            Cyclic <Tip text="Head-to-tail cyclization for cyclic peptides or circular proteins." />
          </span>
        </label>

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label className="field-label" style={{ margin: 0, fontSize: 11 }}>
              Modifications <Tip text="Post-translational modifications. Residue position (1-indexed) + CCD code (e.g., SEP=phosphoserine, TPO=phosphothreonine, PTR=phosphotyrosine)." />
            </label>
            <button type="button" className="link-btn" style={{ fontSize: 11 }} onClick={onAddMod}>+ Add</button>
          </div>
          {protein.modifications.map((mod, mi) => (
            <div key={mi} className="constraint-row" style={{ marginTop: 4 }}>
              <input className="field-input constraint-sm" placeholder="Position" type="number" min={1}
                value={mod.position} onChange={(e) => onSetMod(mi, { position: e.target.value })} />
              <input className="field-input constraint-sm" placeholder="CCD code"
                style={{ textTransform: 'uppercase' }} value={mod.ccd}
                onChange={(e) => onSetMod(mi, { ccd: e.target.value.toUpperCase() })} />
              <button type="button" className="btn-remove-xs" onClick={() => onRemoveMod(mi)}>&times;</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Ligand Card
   ================================================================ */

interface LigandCardProps {
  ligand: LigandEntity;
  index: number;
  onChange: (patch: Partial<LigandEntity>) => void;
  onRemove: () => void;
}

function LigandCard({ ligand, index, onChange, onRemove }: LigandCardProps) {
  return (
    <div className="boltz-entity-card">
      <div className="boltz-entity-header">
        <span className="boltz-entity-badge boltz-badge-ligand">Ligand</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label className="field-label" style={{ margin: 0, fontSize: 11 }}>Chain ID</label>
          <input
            className="field-input boltz-chain-id"
            maxLength={2}
            value={ligand.id}
            onChange={(e) => onChange({ id: e.target.value.toUpperCase() })}
          />
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn-remove-sm" title="Remove" onClick={onRemove}>&times;</button>
      </div>

      {/* Input type toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <label className="field-label" style={{ margin: 0 }}>Input</label>
        <label className="boltz-radio">
          <input type="radio" name={`lig-type-${index}`} checked={ligand.inputType === 'ccd'}
            onChange={() => onChange({ inputType: 'ccd' })} />
          CCD Code <Tip text="3-character PDB Chemical Component Dictionary identifier (e.g., ATP, SAH, HEM, ZN, MG)." />
        </label>
        <label className="boltz-radio">
          <input type="radio" name={`lig-type-${index}`} checked={ligand.inputType === 'smiles'}
            onChange={() => onChange({ inputType: 'smiles' })} />
          SMILES <Tip text="Standard SMILES notation. Use canonical SMILES from RDKit for best compatibility." />
        </label>
      </div>

      {ligand.inputType === 'ccd' ? (
        <div>
          <input className="field-input mono" placeholder="e.g., ATP, SAH, HEM, ZN, MG"
            style={{ textTransform: 'uppercase', maxWidth: 300 }}
            value={ligand.ccd} onChange={(e) => onChange({ ccd: e.target.value.toUpperCase() })} />
          <div className="field-hint">
            <a href="https://www.rcsb.org/chemical-component-search" target="_blank" rel="noopener noreferrer">
              Look up CCD codes at RCSB &rarr;
            </a>
          </div>
        </div>
      ) : (
        <input className="field-input mono" placeholder="e.g., N[C@@H](Cc1ccc(O)cc1)C(=O)O"
          value={ligand.smiles} onChange={(e) => onChange({ smiles: e.target.value })} />
      )}
    </div>
  );
}

/* ================================================================
   Constraint Section (shared layout)
   ================================================================ */

interface ConstraintSectionProps {
  title: string;
  tip: string;
  onAdd: () => void;
  empty: boolean;
  last?: boolean;
  children: React.ReactNode;
}

function ConstraintSection({ title, tip, onAdd, empty, last, children }: ConstraintSectionProps) {
  return (
    <div style={{ marginBottom: last ? 0 : 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <label className="field-label" style={{ margin: 0 }}>
          {title} <Tip text={tip} />
        </label>
        <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={onAdd}>
          + Add
        </button>
      </div>
      {children}
      {empty && <div className="constraint-empty">None defined</div>}
    </div>
  );
}
