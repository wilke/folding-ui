import { useState } from 'react';
import type { ToolId } from './ToolSelector';
import SequenceInput from './SequenceInput';

// ── Types ────────────────────────────────────────────────

export interface UnifiedParams {
  // Global (CWL: output_dir, num_samples, num_recycles, seed, output_format, device)
  outputDir: string;
  numSamples: number;
  numRecycles: number;
  outputFormat: 'pdb' | 'mmcif';
  device: 'gpu' | 'cpu';
  seed: string;

  // Boltz/Chai (CWL: sampling_steps)
  samplingSteps: number;

  // Boltz only (CWL: use_potentials)
  usePotentials: boolean;

  // AlphaFold (CWL: af2_model_preset, af2_db_preset, af2_max_template_date)
  af2ModelPreset: string;
  af2DbPreset: string;
  af2MaxTemplateDate: string;

  // ESMFold (CWL: fp16, chunk_size, max_tokens_per_batch)
  fp16: boolean;
  chunkSize: string;
  maxTokensPerBatch: string;

  // Report (CWL: report_name — report_format is always 'all')
  reportName: string;
}

export const UNIFIED_DEFAULTS: UnifiedParams = {
  outputDir: '/user@bvbrc/home/StructurePrediction/',
  numSamples: 1,
  numRecycles: 3,
  outputFormat: 'pdb',
  device: 'gpu',
  seed: '',
  samplingSteps: 200,
  usePotentials: false,
  af2ModelPreset: 'monomer',
  af2DbPreset: 'reduced_dbs',
  af2MaxTemplateDate: '2022-01-01',
  fp16: false,
  chunkSize: '',
  maxTokensPerBatch: '',
  reportName: 'report',
};

const RESOURCE_HINTS: Record<string, string> = {
  auto: 'Depends on auto-selected tool',
  boltz: '8 CPU, 64 GB, A100/H100/H200 GPU, ~2h',
  chai: '8 CPU, 64 GB, A100/H100/H200 GPU, ~1.5h',
  alphafold: '8 CPU, 64 GB, A100/H100/H200 GPU, ~3h',
  esmfold: '8 CPU, 32 GB, GPU optional, ~15 min',
};

// ── Helpers ──────────────────────────────────────────────

function isDiffusion(tool: ToolId): boolean {
  return tool === 'boltz' || tool === 'chai';
}

function showMsa(tool: ToolId): boolean {
  return tool !== 'esmfold';
}

function toolLabel(tool: ToolId): string {
  switch (tool) {
    case 'boltz': return 'Boltz-2';
    case 'chai': return 'Chai-1';
    case 'alphafold': return 'AlphaFold 2';
    case 'esmfold': return 'ESMFold';
    default: return tool;
  }
}

/**
 * Predict which tool auto mode will select, mirroring the CLI logic in
 * predict_structure/cli.py::_auto_select_tool.
 *
 * Rules (accuracy-priority order: Boltz > Chai > AlphaFold > ESMFold):
 *  - CPU + protein-only → ESMFold
 *  - Non-protein entities → skip AlphaFold & ESMFold
 *  - No MSA file → skip Boltz & Chai (no MSA server available)
 *  - Otherwise first match wins
 */
function predictAutoTool(
  device: 'gpu' | 'cpu',
  hasNonProtein: boolean,
  hasMsa: boolean,
): { tool: string; reason: string } | null {
  if (device === 'cpu' && !hasNonProtein) {
    return { tool: 'esmfold', reason: 'CPU mode, protein-only' };
  }

  for (const t of ['boltz', 'chai', 'alphafold', 'esmfold'] as const) {
    if ((t === 'alphafold' || t === 'esmfold') && hasNonProtein) continue;
    if ((t === 'boltz' || t === 'chai') && !hasMsa) continue;
    const reasons: string[] = [];
    if (t === 'boltz' || t === 'chai') reasons.push('MSA provided');
    if (hasNonProtein) reasons.push('multi-entity');
    if (!hasNonProtein && t === 'alphafold') reasons.push('protein-only, no MSA');
    if (!hasNonProtein && t === 'esmfold') reasons.push('protein-only, no MSA');
    return { tool: t, reason: reasons.join(', ') || 'highest accuracy available' };
  }

  return null;
}

// ── Collapsible Panel ────────────────────────────────────

function Panel({ title, hint, open, onToggle, children }: {
  title: string;
  hint: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 20 }}>
      <button type="button" className="link-btn" onClick={onToggle}>
        <span style={{
          display: 'inline-block',
          transform: open ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.2s',
        }}>&#9654;</span>{' '}
        {title}
      </button>
      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2, marginLeft: 18 }}>{hint}</div>
      {open && (
        <div className="adv-panel" style={{ marginTop: 10 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────

interface Props {
  tool: ToolId;
  value: UnifiedParams;
  onChange: (params: UnifiedParams) => void;
  onBrowseOutput?: () => void;
  msaValue: string;
  onMsaChange: (val: string) => void;
  onMsaFileSelect: (file: File) => void;
  onBrowseMsa?: () => void;
  hasNonProteinEntities?: boolean;
}

export default function UnifiedParameterForm({ tool, value, onChange, onBrowseOutput, msaValue, onMsaChange, onMsaFileSelect, onBrowseMsa, hasNonProteinEntities }: Props) {
  const [paramsOpen, setParamsOpen] = useState(false);
  const [msaOpen, setMsaOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const set = <K extends keyof UnifiedParams>(key: K, val: UnifiedParams[K]) =>
    onChange({ ...value, [key]: val });

  return (
    <div>
      {/* ── Parameters Panel ──────────────────────────── */}
      <Panel
        title="Parameters"
        hint="Samples, recycling, output format, device, seed, and tool-specific options"
        open={paramsOpen}
        onToggle={() => setParamsOpen(!paramsOpen)}
      >
        <div className="param-grid">
          <div>
            <label className="field-label">Number of Samples</label>
            <input
              type="number"
              className="field-input"
              min={1}
              max={25}
              value={value.numSamples}
              onChange={(e) => set('numSamples', Number(e.target.value))}
            />
            <div className="field-hint">
              {tool === 'esmfold' || tool === 'alphafold'
                ? 'N/A for this tool (deterministic)'
                : 'Structure samples to generate [default: 1]'}
            </div>
          </div>
          <div>
            <label className="field-label">Recycling Steps</label>
            <input
              type="number"
              className="field-input"
              min={1}
              max={20}
              value={value.numRecycles}
              onChange={(e) => set('numRecycles', Number(e.target.value))}
            />
            <div className="field-hint">Recycling iterations [default: 3]</div>
          </div>
          <div>
            <label className="field-label">Output Format</label>
            <select
              className="field-input"
              value={value.outputFormat}
              onChange={(e) => set('outputFormat', e.target.value as 'pdb' | 'mmcif')}
            >
              <option value="pdb">PDB</option>
              <option value="mmcif">mmCIF</option>
            </select>
          </div>
        </div>

        <div className="param-grid" style={{ marginTop: 16 }}>
          <div>
            <label className="field-label">Device</label>
            <select
              className="field-input"
              value={value.device}
              onChange={(e) => set('device', e.target.value as 'gpu' | 'cpu')}
            >
              <option value="gpu">GPU</option>
              <option value="cpu">CPU</option>
            </select>
            <div className="field-hint">Compute device [default: gpu]</div>
          </div>
          <div>
            <label className="field-label">Random Seed</label>
            <input
              type="text"
              className="field-input"
              placeholder="Optional"
              value={value.seed}
              onChange={(e) => set('seed', e.target.value)}
            />
            <div className="field-hint">For reproducibility</div>
          </div>
          <div />
        </div>

        {/* Tool-specific options inline */}
        {tool !== 'auto' && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 12 }}>
              {toolLabel(tool)} Options
            </div>

            {/* Boltz / Chai: sampling_steps */}
            {isDiffusion(tool) && (
              <div className="param-grid">
                <div>
                  <label className="field-label">Sampling Steps</label>
                  <input
                    type="number"
                    className="field-input"
                    min={1}
                    max={1000}
                    value={value.samplingSteps}
                    onChange={(e) => set('samplingSteps', Number(e.target.value))}
                  />
                  <div className="field-hint">Diffusion sampling steps [default: 200]</div>
                </div>
                <div />
                <div />
              </div>
            )}

            {/* Boltz only: use_potentials */}
            {tool === 'boltz' && (
              <div style={{ marginTop: isDiffusion(tool) ? 16 : 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={value.usePotentials}
                    onChange={(e) => set('usePotentials', e.target.checked)}
                  />
                  Use Potentials
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>(inference-time potential terms)</span>
                </label>
              </div>
            )}

            {/* AlphaFold 2 */}
            {tool === 'alphafold' && (
              <div className="param-grid">
                <div>
                  <label className="field-label">Model Preset</label>
                  <select
                    className="field-input"
                    value={value.af2ModelPreset}
                    onChange={(e) => set('af2ModelPreset', e.target.value)}
                  >
                    <option value="monomer">monomer</option>
                    <option value="monomer_casp14">monomer_casp14</option>
                    <option value="multimer">multimer</option>
                  </select>
                  <div className="field-hint">AlphaFold2 model preset [default: monomer]</div>
                </div>
                <div>
                  <label className="field-label">Database Preset</label>
                  <select
                    className="field-input"
                    value={value.af2DbPreset}
                    onChange={(e) => set('af2DbPreset', e.target.value)}
                  >
                    <option value="reduced_dbs">reduced_dbs</option>
                    <option value="full_dbs">full_dbs</option>
                  </select>
                  <div className="field-hint">Database preset [default: reduced_dbs]</div>
                </div>
                <div>
                  <label className="field-label">Max Template Date</label>
                  <input
                    type="date"
                    className="field-input"
                    value={value.af2MaxTemplateDate}
                    onChange={(e) => set('af2MaxTemplateDate', e.target.value)}
                  />
                  <div className="field-hint">Template cutoff [default: 2022-01-01]</div>
                </div>
              </div>
            )}

            {/* ESMFold */}
            {tool === 'esmfold' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={value.fp16}
                    onChange={(e) => set('fp16', e.target.checked)}
                  />
                  Half-Precision (FP16)
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>(faster, lower memory, slight accuracy loss)</span>
                </label>
                <div className="param-grid">
                  <div>
                    <label className="field-label">Chunk Size</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="Auto"
                      value={value.chunkSize}
                      onChange={(e) => set('chunkSize', e.target.value)}
                    />
                    <div className="field-hint">For long sequences</div>
                  </div>
                  <div>
                    <label className="field-label">Max Tokens per Batch</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="Auto"
                      value={value.maxTokensPerBatch}
                      onChange={(e) => set('maxTokensPerBatch', e.target.value)}
                    />
                    <div className="field-hint">Batching limit</div>
                  </div>
                  <div />
                </div>
              </>
            )}
          </div>
        )}
      </Panel>

      {/* ── MSA Panel ─────────────────────────────────── */}
      {showMsa(tool) && (
        <Panel
          title="Multiple Sequence Alignment"
          hint="Provide a pre-computed MSA file to improve accuracy (optional)"
          open={msaOpen}
          onToggle={() => setMsaOpen(!msaOpen)}
        >
          <SequenceInput
            value={msaValue}
            onChange={onMsaChange}
            onFileSelect={onMsaFileSelect}
            onWorkspaceSelect={onBrowseMsa!}
            title="MSA File"
            subtitle="Upload or paste a pre-computed alignment (.a3m, .sto, .pqt)"
            accept=".a3m,.sto,.pqt"
            placeholder="Paste MSA content here..."
            dropHint="Drop .a3m, .sto, .pqt file here or"
          />

          <div className="info-box" style={{ marginTop: 12 }}>
            {tool === 'alphafold'
              ? 'AlphaFold 2 uses jackhmmer for MSA generation. Upload a precomputed MSA to skip this step.'
              : 'Providing an MSA improves prediction accuracy for Boltz and Chai. Without an MSA, single-sequence mode is used.'}
          </div>
        </Panel>
      )}

      {tool === 'esmfold' && (
        <div style={{ marginTop: 12, marginLeft: 18, fontSize: 12, color: '#94A3B8' }}>
          ESMFold uses single-sequence prediction (no MSA needed).
        </div>
      )}

      {/* ── Report Panel ──────────────────────────────── */}
      <Panel
        title="Report"
        hint="Characterization report generated after structure prediction"
        open={reportOpen}
        onToggle={() => setReportOpen(!reportOpen)}
      >
        <div className="param-grid">
          <div>
            <label className="field-label">Report Name</label>
            <input
              type="text"
              className="field-input"
              value={value.reportName}
              onChange={(e) => set('reportName', e.target.value)}
            />
            <div className="field-hint">Output filename (without extension) [default: report]</div>
          </div>
          <div>
            <label className="field-label">Report Format</label>
            <input
              type="text"
              className="field-input"
              value="All (HTML + PDF + JSON)"
              disabled
              style={{ background: '#F1F5F9', color: '#64748B' }}
            />
            <div className="field-hint">All report formats are generated automatically</div>
          </div>
          <div />
        </div>
      </Panel>

      {/* ── Resource Estimate ──────────────────────────── */}
      {(() => {
        const prediction = tool === 'auto'
          ? predictAutoTool(value.device, !!hasNonProteinEntities, !!msaValue.trim())
          : null;
        const effectiveTool = prediction?.tool ?? tool;
        return (
          <div className="resource-bar" style={{ marginTop: 20 }}>
            <div>
              {prediction ? (
                <>
                  <strong>Auto </strong>
                  <span style={{ margin: '0 4px', color: '#94A3B8' }}>&rarr;</span>
                  <strong>{toolLabel(prediction.tool as ToolId)}</strong>
                  <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 6 }}>({prediction.reason})</span>
                  <span style={{ margin: '0 8px', color: '#E2E8F0' }}>|</span>
                  <span>{RESOURCE_HINTS[prediction.tool] ?? ''}</span>
                </>
              ) : (
                <>
                  <strong>Estimated Resources: </strong>
                  <span>{RESOURCE_HINTS[tool] ?? ''}</span>
                </>
              )}
            </div>
            <span className="badge b-blue">{effectiveTool === 'esmfold' ? 'cpu / gpu2' : 'gpu2 partition'}</span>
          </div>
        );
      })()}

      {/* ── Output Folder ──────────────────────────────── */}
      <div style={{ marginTop: 20 }}>
        <label className="field-label">Output Folder</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="field-input mono"
            style={{ flex: 1 }}
            value={value.outputDir}
            onChange={(e) => set('outputDir', e.target.value)}
          />
          <button type="button" className="btn-outline" onClick={onBrowseOutput}>Browse</button>
        </div>
        <div className="field-hint" style={{ marginTop: 4 }}>
          Results will be saved to this workspace folder
        </div>
      </div>
    </div>
  );
}

// ── Build CWL inputs from form state ─────────────────────

/** Resolved entity references ready for CWL submission. */
export interface CwlEntityInputs {
  protein?: Record<string, unknown>[];
  dna?: Record<string, unknown>[];
  rna?: Record<string, unknown>[];
  ligand?: string[];
  smiles?: string[];
  glycan?: string[];
  msa?: Record<string, unknown>;
}

export function buildUnifiedCwlInputs(
  tool: ToolId,
  params: UnifiedParams,
  entities: CwlEntityInputs,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {
    tool,                          // always required (auto is a valid enum value)
    // Note: output_dir is NOT set — CWL defaults to "output" (local container dir).
    // The workspace destination is set via output_destination at the submission level.
  };

  // Entity inputs — only include non-empty arrays
  if (entities.protein && entities.protein.length > 0) inputs.protein = entities.protein;
  if (entities.dna && entities.dna.length > 0) inputs.dna = entities.dna;
  if (entities.rna && entities.rna.length > 0) inputs.rna = entities.rna;
  if (entities.ligand && entities.ligand.length > 0) inputs.ligand = entities.ligand;
  if (entities.smiles && entities.smiles.length > 0) inputs.smiles = entities.smiles;
  if (entities.glycan && entities.glycan.length > 0) inputs.glycan = entities.glycan;

  // Global options — only include when different from CWL defaults
  if (params.numSamples !== 1) inputs.num_samples = params.numSamples;
  if (params.numRecycles !== 3) inputs.num_recycles = params.numRecycles;
  if (params.outputFormat !== 'pdb') inputs.output_format = params.outputFormat;
  if (params.device !== 'gpu') inputs.device = params.device;
  if (params.seed) inputs.seed = Number(params.seed);

  // MSA
  if (entities.msa) inputs.msa = entities.msa;

  // Report options — always generate all formats
  if (params.reportName && params.reportName !== 'report') inputs.report_name = params.reportName;
  inputs.report_format = 'all';

  // Boltz / Chai
  if (tool === 'boltz' || tool === 'chai') {
    if (params.samplingSteps !== 200) inputs.sampling_steps = params.samplingSteps;
  }

  // Boltz only
  if (tool === 'boltz') {
    if (params.usePotentials) inputs.use_potentials = true;
  }

  // AlphaFold
  if (tool === 'alphafold') {
    if (params.af2ModelPreset !== 'monomer') inputs.af2_model_preset = params.af2ModelPreset;
    if (params.af2DbPreset !== 'reduced_dbs') inputs.af2_db_preset = params.af2DbPreset;
    if (params.af2MaxTemplateDate !== '2022-01-01') inputs.af2_max_template_date = params.af2MaxTemplateDate;
  }

  // ESMFold
  if (tool === 'esmfold') {
    if (params.fp16) inputs.fp16 = true;
    if (params.chunkSize) inputs.chunk_size = Number(params.chunkSize);
    if (params.maxTokensPerBatch) inputs.max_tokens_per_batch = Number(params.maxTokensPerBatch);
  }

  return inputs;
}
