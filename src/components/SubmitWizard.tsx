import { useState } from 'react';
import type { ToolId } from './ToolSelector';
import ToolSelector from './ToolSelector';
import SequenceInput from './SequenceInput';
import EntityInputPanel, { type EntityInputs } from './EntityInputPanel';
import type { UnifiedParams } from './UnifiedParameterForm';

// ── Sequence type detection ──────────────────────────────

type SeqType = 'protein' | 'dna' | 'rna' | 'unknown';

const SEQ_TYPE_META: Record<SeqType, { label: string; badge: string; color: string }> = {
  protein: { label: 'Protein', badge: 'b-green', color: '#10B981' },
  dna:     { label: 'DNA',     badge: 'b-blue',  color: '#3B82F6' },
  rna:     { label: 'RNA',     badge: 'b-purple', color: '#8B5CF6' },
  unknown: { label: 'Unknown', badge: 'b-gray',   color: '#94A3B8' },
};

/**
 * Detect whether pasted/uploaded content is protein, DNA, or RNA.
 * Uses amino-acid-exclusive letters (E, F, I, L, P, Q) to distinguish
 * protein from nucleotide sequences.
 */
function detectSequenceType(raw: string): SeqType {
  if (raw.startsWith('workspace://')) return 'unknown';
  const cleaned = raw.replace(/^>.*$/gm, '').replace(/[\s\d]/g, '').toUpperCase();
  if (cleaned.length < 3) return 'unknown';

  // RNA: has U but not T
  if (cleaned.includes('U') && !cleaned.includes('T')) return 'rna';

  // Protein-exclusive letters not in nucleotide IUPAC codes
  if (/[EFIJLOPQZ]/.test(cleaned)) return 'protein';

  // All chars are nucleotide IUPAC → DNA
  if (/^[ATGCNRYSWKMBDHV]+$/.test(cleaned)) return 'dna';

  // All chars are valid amino acids → protein
  if (/^[ACDEFGHIKLMNPQRSTVWYX*]+$/.test(cleaned)) return 'protein';

  return 'unknown';
}

// ── Auto-tool prediction (mirrors cli.py) ────────────────

function predictAutoTool(
  device: 'gpu' | 'cpu',
  hasNonProtein: boolean,
  hasMsa: boolean,
  useMsaServer: boolean,
): { tool: string; label: string; reason: string } | null {
  const msaAvailable = hasMsa || useMsaServer;

  if (device === 'cpu' && !hasNonProtein) {
    return { tool: 'esmfold', label: 'ESMFold', reason: 'CPU mode, protein-only' };
  }

  const toolLabels: Record<string, string> = {
    boltz: 'Boltz-2', chai: 'Chai-1', alphafold: 'AlphaFold 2', esmfold: 'ESMFold',
  };

  for (const t of ['boltz', 'chai', 'alphafold', 'esmfold']) {
    if ((t === 'alphafold' || t === 'esmfold') && hasNonProtein) continue;
    if ((t === 'boltz' || t === 'chai') && !msaAvailable) continue;
    const reasons: string[] = [];
    if (msaAvailable && (t === 'boltz' || t === 'chai')) reasons.push('MSA available');
    if (hasNonProtein) reasons.push('multi-entity');
    if (!reasons.length) reasons.push('highest accuracy available');
    return { tool: t, label: toolLabels[t] ?? t, reason: reasons.join(', ') };
  }

  return null;
}

// ── Step definitions ─────────────────────────────────────

const STEPS = ['sequence', 'entities', 'msa', 'review'] as const;
type StepKey = typeof STEPS[number];

const STEP_META: Record<StepKey, { num: number; label: string }> = {
  sequence: { num: 1, label: 'Sequence' },
  entities: { num: 2, label: 'Components' },
  msa:      { num: 3, label: 'Alignment' },
  review:   { num: 4, label: 'Review' },
};

// ── Props ────────────────────────────────────────────────

interface WizardProps {
  sequence: string;
  onSequenceChange: (s: string) => void;
  onSequenceFileSelect: (f: File) => void;
  onSequenceWorkspaceSelect: () => void;

  entities: EntityInputs;
  onEntitiesChange: (e: EntityInputs) => void;
  onEntityBrowse: (type: 'dna' | 'rna') => void;

  msaValue: string;
  onMsaChange: (v: string) => void;
  onMsaFileSelect: (f: File) => void;
  onBrowseMsa: () => void;

  tool: ToolId;
  onToolChange: (t: ToolId) => void;
  params: UnifiedParams;
  onParamsChange: (p: UnifiedParams) => void;
  onBrowseOutput: () => void;

  onSubmit: () => void;
  onPreview: () => void;
  previewData: { endpoint: string; body: Record<string, unknown> } | null;
  onDismissPreview: () => void;
  submitting: boolean;
  error: string | null;
}

// ── Help Box ─────────────────────────────────────────────

function HelpBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="wizard-help">
      <span className="wizard-help-icon">&#x1F4A1;</span>
      <div>{children}</div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────

export default function SubmitWizard(props: WizardProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  const seqType = detectSequenceType(props.sequence);
  const hasNonProtein =
    props.entities.dnas.length > 0 || props.entities.rnas.length > 0 ||
    props.entities.ligands.length > 0 || props.entities.smiles.length > 0 ||
    props.entities.glycans.length > 0;
  const hasMsa = !!props.msaValue.trim();
  const prediction = predictAutoTool(
    props.params.device, hasNonProtein, hasMsa, props.params.useMsaServer,
  );
  const entityCount =
    props.entities.dnas.length + props.entities.rnas.length +
    props.entities.ligands.length + props.entities.smiles.length +
    props.entities.glycans.length;

  const canNext = (): boolean => {
    switch (step) {
      case 'sequence': return !!props.sequence.trim();
      default: return true;
    }
  };

  const set = <K extends keyof UnifiedParams>(key: K, val: UnifiedParams[K]) =>
    props.onParamsChange({ ...props.params, [key]: val });

  return (
    <div>
      {/* ── Progress Bar ──────────────────────────────── */}
      <div className="wizard-progress">
        {STEPS.map((s, i) => {
          const meta = STEP_META[s];
          const state = i < stepIdx ? 'done' : i === stepIdx ? 'active' : '';
          return (
            <div key={s} className="wizard-step-wrapper">
              {i > 0 && <div className={`wizard-connector ${i <= stepIdx ? 'done' : ''}`} />}
              <button
                type="button"
                className={`wizard-step ${state}`}
                onClick={() => i <= stepIdx && setStepIdx(i)}
                disabled={i > stepIdx}
              >
                <span className={`wizard-step-num ${state}`}>
                  {i < stepIdx ? '\u2713' : meta.num}
                </span>
                <span className={`wizard-step-label ${state}`}>{meta.label}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Step 1: Sequence ──────────────────────────── */}
      {step === 'sequence' && (
        <div className="wizard-content">
          <h2 className="wizard-title">What sequence would you like to predict?</h2>
          <p className="wizard-desc">
            Paste a FASTA-formatted sequence, upload a file, or select one from your workspace.
          </p>

          <SequenceInput
            value={props.sequence}
            onChange={props.onSequenceChange}
            onFileSelect={props.onSequenceFileSelect}
            onWorkspaceSelect={props.onSequenceWorkspaceSelect}
            title="Input Sequence"
            subtitle="Protein, DNA, or RNA sequence in FASTA format"
          />

          {props.sequence.trim() && seqType !== 'unknown' && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`badge ${SEQ_TYPE_META[seqType].badge}`}>
                Detected: {SEQ_TYPE_META[seqType].label}
              </span>
              {seqType === 'dna' && (
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  This will be used as the primary protein input. Add DNA entities in the next step if needed.
                </span>
              )}
            </div>
          )}

          <HelpBox>
            <strong>FASTA format:</strong> Start with a header line (<code>&gt;name</code>) followed by the sequence.
            Most predictions start with a protein sequence. You can add DNA, RNA, and small molecules in the next step.
          </HelpBox>
        </div>
      )}

      {/* ── Step 2: Additional Components ─────────────── */}
      {step === 'entities' && (
        <div className="wizard-content">
          <h2 className="wizard-title">Does your structure include other molecular components?</h2>
          <p className="wizard-desc">
            Add additional molecules for complex assemblies — protein-DNA interactions,
            ligand binding, multi-chain structures.
          </p>

          <div className="wizard-entity-cards">
            <div className="wizard-entity-card">
              <div className="wizard-entity-card-icon">{'\uD83E\uDDEC'}</div>
              <div><strong>DNA / RNA</strong></div>
              <div className="wizard-entity-card-desc">Nucleic acid chains for protein-DNA/RNA complex prediction</div>
            </div>
            <div className="wizard-entity-card">
              <div className="wizard-entity-card-icon">{'\uD83D\uDC8A'}</div>
              <div><strong>Ligands</strong></div>
              <div className="wizard-entity-card-desc">Small molecules by CCD code (e.g. ATP, HEM, FAD)</div>
            </div>
            <div className="wizard-entity-card">
              <div className="wizard-entity-card-icon">{'\u2697\uFE0F'}</div>
              <div><strong>SMILES</strong></div>
              <div className="wizard-entity-card-desc">Custom small molecules as SMILES strings</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <EntityInputPanel
              value={props.entities}
              onChange={props.onEntitiesChange}
              onBrowseWorkspace={props.onEntityBrowse}
              defaultOpen
            />
          </div>

          <HelpBox>
            <strong>Single protein?</strong> Skip this step — it's only needed for complexes.
            Ligand binding predictions (e.g., drug + protein) require <strong>Boltz</strong> or <strong>Chai</strong> with MSA.
          </HelpBox>
        </div>
      )}

      {/* ── Step 3: MSA ───────────────────────────────── */}
      {step === 'msa' && (
        <div className="wizard-content">
          <h2 className="wizard-title">Improve accuracy with a multiple sequence alignment?</h2>
          <p className="wizard-desc">
            An MSA provides evolutionary context from related sequences, significantly improving
            prediction accuracy for Boltz and Chai.
          </p>

          <SequenceInput
            value={props.msaValue}
            onChange={props.onMsaChange}
            onFileSelect={props.onMsaFileSelect}
            onWorkspaceSelect={props.onBrowseMsa}
            title="MSA File"
            subtitle="Upload or paste a pre-computed alignment (.a3m, .sto, .pqt)"
            accept=".a3m,.sto,.pqt"
            placeholder="Paste MSA content here..."
            dropHint="Drop .a3m, .sto, .pqt file here or"
          />

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={props.params.useMsaServer}
                onChange={(e) => set('useMsaServer', e.target.checked)}
              />
              Use MSA Server
              <span style={{ fontSize: 11, color: '#94A3B8' }}>(generate alignment on-the-fly via ColabFold MMseqs2)</span>
            </label>
            {props.params.useMsaServer && (
              <div style={{ marginLeft: 24 }}>
                <label className="field-label">MSA Server URL</label>
                <input
                  type="text"
                  className="field-input mono"
                  placeholder="Leave blank for default ColabFold server"
                  value={props.params.msaServerUrl}
                  onChange={(e) => set('msaServerUrl', e.target.value)}
                />
              </div>
            )}
          </div>

          {prediction && (
            <div className="info-box" style={{ marginTop: 16 }}>
              <strong>Tool impact:</strong>{' '}
              {hasMsa || props.params.useMsaServer ? (
                <>
                  With MSA, <strong>{prediction.label}</strong> will be auto-selected for best accuracy.
                </>
              ) : (
                <>
                  Without MSA, Boltz and Chai are skipped.{' '}
                  {hasNonProtein
                    ? 'No tool supports your entity combination without MSA — consider enabling the MSA server.'
                    : <><strong>AlphaFold 2</strong> will generate its own alignment (slower), or <strong>ESMFold</strong> will run without one.</>
                  }
                </>
              )}
            </div>
          )}

          <HelpBox>
            <strong>Don't have an MSA?</strong> Enable the MSA Server checkbox to generate one automatically.
            Alternatively, AlphaFold creates its own, and ESMFold works without one entirely.
          </HelpBox>
        </div>
      )}

      {/* ── Step 4: Review & Submit ───────────────────── */}
      {step === 'review' && (
        <div className="wizard-content">
          <h2 className="wizard-title">Review and submit your prediction</h2>
          <p className="wizard-desc">
            Choose your prediction tool, set the output location, and submit.
          </p>

          {/* Tool selection */}
          <div style={{ marginBottom: 20 }}>
            <label className="field-label" style={{ marginBottom: 8 }}>Prediction Tool</label>
            <ToolSelector value={props.tool} onChange={props.onToolChange} />
            {props.tool === 'auto' && prediction && (
              <div className="wizard-auto-bar">
                <strong>Auto</strong>
                <span style={{ margin: '0 6px', color: '#94A3B8' }}>&rarr;</span>
                <strong>{prediction.label}</strong>
                <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 6 }}>
                  ({prediction.reason})
                </span>
              </div>
            )}
          </div>

          {/* Input summary */}
          <div className="wizard-summary">
            <div className="wizard-summary-title">Input Summary</div>
            <div className="wizard-summary-grid">
              <div className="wizard-summary-item">
                <span className="wizard-summary-label">Sequence</span>
                <span className="wizard-summary-value">
                  {props.sequence.startsWith('workspace://')
                    ? props.sequence.replace('workspace://', '').split('/').pop()
                    : props.sequence.trim().split('\n')[0]?.slice(0, 40) || 'None'}
                  {seqType !== 'unknown' && (
                    <span className={`badge ${SEQ_TYPE_META[seqType].badge}`} style={{ marginLeft: 6, fontSize: 10 }}>
                      {SEQ_TYPE_META[seqType].label}
                    </span>
                  )}
                </span>
              </div>
              <div className="wizard-summary-item">
                <span className="wizard-summary-label">Additional Entities</span>
                <span className="wizard-summary-value">{entityCount > 0 ? `${entityCount} added` : 'None'}</span>
              </div>
              <div className="wizard-summary-item">
                <span className="wizard-summary-label">MSA</span>
                <span className="wizard-summary-value">
                  {hasMsa ? 'Provided' : props.params.useMsaServer ? 'MSA Server' : 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* Output folder */}
          <div style={{ marginTop: 20 }}>
            <label className="field-label">Output Folder</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="field-input mono"
                style={{ flex: 1 }}
                value={props.params.outputDir}
                onChange={(e) => set('outputDir', e.target.value)}
              />
              <button type="button" className="btn-outline" onClick={props.onBrowseOutput}>Browse</button>
            </div>
          </div>

          {/* Resource estimate */}
          {prediction && props.tool === 'auto' && (
            <div className="resource-bar" style={{ marginTop: 16 }}>
              <div>
                <strong>Estimated Resources: </strong>
                <span>{
                  ({ boltz: '~2h', chai: '~1.5h', alphafold: '~3h', esmfold: '~15 min' } as Record<string, string>)[prediction.tool] ?? ''
                }, GPU</span>
              </div>
              <span className="badge b-blue">{prediction.tool === 'esmfold' ? 'cpu / gpu2' : 'gpu2 partition'}</span>
            </div>
          )}

          {props.error && <div className="error-banner" style={{ marginTop: 16 }}>{props.error}</div>}
        </div>
      )}

      {/* ── Navigation ────────────────────────────────── */}
      <div className="wizard-nav">
        <div>
          {stepIdx > 0 && (
            <button type="button" className="btn-outline" onClick={() => setStepIdx(stepIdx - 1)}>
              &larr; Back
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {step !== 'review' && step !== 'sequence' && (
            <button type="button" className="btn-outline" onClick={() => setStepIdx(stepIdx + 1)}>
              Skip
            </button>
          )}
          {step === 'review' ? (
            <>
              <button
                type="button"
                className="btn-outline"
                onClick={props.onPreview}
                disabled={!props.sequence.trim()}
              >
                Preview
              </button>
              <button
                type="button"
                className="btn-submit"
                onClick={() => { props.onDismissPreview(); props.onSubmit(); }}
                disabled={props.submitting || !props.sequence.trim()}
              >
                {props.submitting ? 'Submitting...' : 'Submit Job'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setStepIdx(stepIdx + 1)}
              disabled={!canNext()}
            >
              Next &rarr;
            </button>
          )}
        </div>
      </div>

      {/* ── Preview Panel ─────────────────────────────── */}
      {props.previewData && (
        <div className="preview-panel">
          <div className="preview-panel-header">
            <span className="preview-panel-title">Submission Preview</span>
            <button type="button" className="btn-close" onClick={props.onDismissPreview}>&times;</button>
          </div>
          <div className="preview-panel-endpoint">{props.previewData.endpoint}</div>
          <pre className="preview-panel-body">{JSON.stringify(props.previewData.body, null, 2)}</pre>
        </div>
      )}

      {/* ── Help Footer ───────────────────────────────── */}
      <div className="wizard-footer">
        <span style={{ fontSize: 14 }}>&#x2753;</span>
        <span>Need help with your submission?</span>
        <a href="#" onClick={(e) => e.preventDefault()} className="wizard-footer-link">
          Chat with our assistant &rarr;
        </a>
      </div>
    </div>
  );
}
