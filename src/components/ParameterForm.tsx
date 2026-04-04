import { useState } from 'react';
import type { ToolId } from './ToolSelector';
import SequenceInput from './SequenceInput';

/* ================================================================
   Tooltip — CSS-only hover tooltip for CWL doc strings
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
   Per-tool param types — keys match CWL input names exactly
   ================================================================ */

export interface BoltzParams {
  diffusion_samples: string;
  recycling_steps: string;
  sampling_steps: string;
  output_format: string;
  accelerator: string;
  use_potentials: boolean;
  write_full_pae: boolean;
}

export interface ChaiParams {
  num_diffn_samples: string;
  num_trunk_recycles: string;
  num_diffn_timesteps: string;
  num_trunk_samples: string;
  seed: string;
  device: string;
  constraint_path: string;
  template_hits_path: string;
  recycle_msa_subsample: string;
  no_use_esm_embeddings: boolean;
  no_low_memory: boolean;
}

/** AlphaFold max template date — determined by the installed PDB database snapshot. */
export const AF_MAX_TEMPLATE_DATE = '2022-01-01';

export interface AlphaFoldParams {
  model_preset: string;
  db_preset: string;
  random_seed: string;
  use_gpu_relax: boolean;
  use_precomputed_msas: boolean;
}

export interface ESMFoldParams {
  num_recycles: string;
  chunk_size: string;
  max_tokens_per_batch: string;
  cpu_only: boolean;
  fp16: boolean;
}

/* ================================================================
   Defaults (empty string = optional / use tool default)
   ================================================================ */

const BOLTZ_DEFAULTS: BoltzParams = {
  diffusion_samples: '',
  recycling_steps: '',
  sampling_steps: '',
  output_format: '',
  accelerator: '',
  use_potentials: false,
  write_full_pae: false,
};

const CHAI_DEFAULTS: ChaiParams = {
  num_diffn_samples: '',
  num_trunk_recycles: '',
  num_diffn_timesteps: '',
  num_trunk_samples: '',
  seed: '',
  device: '',
  constraint_path: '',
  template_hits_path: '',
  recycle_msa_subsample: '',
  no_use_esm_embeddings: false,
  no_low_memory: false,
};

const ALPHAFOLD_DEFAULTS: AlphaFoldParams = {
  model_preset: 'monomer',
  db_preset: 'reduced_dbs',
  random_seed: '',
  use_gpu_relax: false,
  use_precomputed_msas: false,
};

const ESMFOLD_DEFAULTS: ESMFoldParams = {
  num_recycles: '',
  chunk_size: '',
  max_tokens_per_batch: '',
  cpu_only: false,
  fp16: false,
};

/* ================================================================
   Composite state — preserves params when switching tools
   ================================================================ */

export interface PredictionParams {
  outputFolder: string;
  boltz: BoltzParams;
  chai: ChaiParams;
  alphafold: AlphaFoldParams;
  esmfold: ESMFoldParams;
}

const DEFAULTS: PredictionParams = {
  outputFolder: '/user@bvbrc/home/StructurePrediction/',
  boltz: { ...BOLTZ_DEFAULTS },
  chai: { ...CHAI_DEFAULTS },
  alphafold: { ...ALPHAFOLD_DEFAULTS },
  esmfold: { ...ESMFOLD_DEFAULTS },
};

/* ================================================================
   Resource hints
   ================================================================ */

const RESOURCE_HINTS: Record<string, { text: string; badge: string }> = {
  boltz:     { text: '8 CPU \u00b7 64\u201396 GB \u00b7 A100/H100/H200 GPU \u00b7 ~2\u20134 h', badge: 'gpu2' },
  chai:      { text: '8 CPU \u00b7 64\u201396 GB \u00b7 A100/H100/H200 GPU \u00b7 ~2\u20133 h', badge: 'gpu2' },
  alphafold: { text: '8 CPU \u00b7 64\u201396 GB \u00b7 A100/H100/H200 GPU \u00b7 ~2\u20138 h', badge: 'gpu2' },
  esmfold:   { text: '8 CPU \u00b7 32 GB \u00b7 GPU optional \u00b7 ~5\u201315 min', badge: 'gpu2' },
};

/* ================================================================
   CWL input / output names per tool
   ================================================================ */

const CWL_FILE_INPUT: Record<string, string> = {
  boltz: 'input_file',
  chai: 'input_fasta',
  alphafold: 'fasta_paths',
  esmfold: 'sequences',
};

/** output_dir is a local directory name inside the worker container.
 *  CWL tools all default to "output" — we never send it.
 *  The workspace destination is set via output_destination at the submission level. */
// const CWL_OUTPUT_DIR — removed: output_dir uses CWL defaults

/** CWL int? fields — values stored as strings, sent as numbers. */
const CWL_INT_FIELDS = new Set([
  'diffusion_samples', 'recycling_steps', 'sampling_steps',
  'num_diffn_samples', 'num_trunk_recycles', 'num_diffn_timesteps', 'num_trunk_samples',
  'seed', 'recycle_msa_subsample',
  'random_seed',
  'num_recycles', 'chunk_size', 'max_tokens_per_batch',
]);

/* ================================================================
   Build CWL inputs from per-tool params
   ================================================================ */

export function buildPerToolCwlInputs(
  tool: string,
  params: PredictionParams,
  inputRef: Record<string, unknown>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  // Input file
  const fileKey = CWL_FILE_INPUT[tool];
  if (fileKey) inputs[fileKey] = inputRef;

  // Note: output_dir is NOT set — CWL defaults to "output" (local container dir).
  // The workspace destination is set via output_destination at the submission level.

  // AlphaFold: always include the fixed max_template_date
  if (tool === 'alphafold') {
    inputs.max_template_date = AF_MAX_TEMPLATE_DATE;
  }

  // Tool-specific params — only include non-empty / non-default values
  const toolKey = tool as 'boltz' | 'chai' | 'alphafold' | 'esmfold';
  const toolParams = params[toolKey];
  if (toolParams && typeof toolParams === 'object') {
    for (const [key, value] of Object.entries(toolParams)) {
      if (typeof value === 'boolean') {
        if (value) inputs[key] = true;
      } else if (typeof value === 'string' && value.trim() !== '') {
        if (CWL_INT_FIELDS.has(key)) {
          const n = Number(value);
          if (!isNaN(n)) inputs[key] = n;
        } else {
          inputs[key] = value;
        }
      }
    }
  }

  return inputs;
}

/* ================================================================
   Component
   ================================================================ */

/** Tools that show the MSA section */
const MSA_TOOLS = new Set(['boltz', 'chai', 'alphafold']);

/** Tools where MSA upload is disabled (shown but grayed out) */
const MSA_DISABLED_TOOLS = new Set(['alphafold']);

interface Props {
  tool: ToolId;
  value: PredictionParams;
  onChange: (params: PredictionParams) => void;
  onBrowseOutput?: () => void;
  /** MSA value (paste content, workspace:// path, or empty) */
  msaValue?: string;
  onMsaChange?: (val: string) => void;
  onMsaFileSelect?: (file: File) => void;
  onBrowseMsa?: () => void;
}

export default function ParameterForm({ tool, value, onChange, onBrowseOutput, msaValue, onMsaChange, onMsaFileSelect, onBrowseMsa }: Props) {
  const [advOpen, setAdvOpen] = useState(false);

  /* ── typed setters per tool ── */
  const setBoltz = <K extends keyof BoltzParams>(key: K, val: BoltzParams[K]) =>
    onChange({ ...value, boltz: { ...value.boltz, [key]: val } });
  const setChai = <K extends keyof ChaiParams>(key: K, val: ChaiParams[K]) =>
    onChange({ ...value, chai: { ...value.chai, [key]: val } });
  const setAlpha = <K extends keyof AlphaFoldParams>(key: K, val: AlphaFoldParams[K]) =>
    onChange({ ...value, alphafold: { ...value.alphafold, [key]: val } });
  const setEsm = <K extends keyof ESMFoldParams>(key: K, val: ESMFoldParams[K]) =>
    onChange({ ...value, esmfold: { ...value.esmfold, [key]: val } });

  const advToggle = (
    <button type="button" className="link-btn" onClick={() => setAdvOpen(!advOpen)}>
      <span style={{ display: 'inline-block', transform: advOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>&#9654;</span>
      {' '}Advanced Options
    </button>
  );

  /* ────────────────────────── Boltz-2 ────────────────────────── */

  const renderBoltz = () => {
    const p = value.boltz;
    return (
      <>
        <div className="param-grid">
          <div>
            <label className="field-label">
              Diffusion Samples <Tip text="Number of diffusion samples to generate. More samples increase structural diversity but take longer." />
            </label>
            <input type="number" className="field-input" min={1} max={25} placeholder="5 (default)"
              value={p.diffusion_samples} onChange={(e) => setBoltz('diffusion_samples', e.target.value)} />
          </div>
          <div>
            <label className="field-label">
              Recycling Steps <Tip text="Number of recycling steps for iterative refinement of the structure." />
            </label>
            <input type="number" className="field-input" min={1} max={20} placeholder="3 (default)"
              value={p.recycling_steps} onChange={(e) => setBoltz('recycling_steps', e.target.value)} />
          </div>
          <div>
            <label className="field-label">
              Sampling Steps <Tip text="Number of diffusion sampling steps. More steps produce smoother denoising trajectories." />
            </label>
            <input type="number" className="field-input" min={1} max={500} placeholder="200 (default)"
              value={p.sampling_steps} onChange={(e) => setBoltz('sampling_steps', e.target.value)} />
          </div>
          <div>
            <label className="field-label">
              Output Format <Tip text="Structure output format. PDB is widely compatible; mmCIF supports richer metadata." />
            </label>
            <select className="field-input" value={p.output_format} onChange={(e) => setBoltz('output_format', e.target.value)}>
              <option value="">Default</option>
              <option value="pdb">PDB</option>
              <option value="mmcif">mmCIF</option>
            </select>
          </div>
          <div>
            <label className="field-label">
              Accelerator <Tip text="Computing device. GPU is required for reasonable performance; CPU mode is for debugging only." />
            </label>
            <select className="field-input" value={p.accelerator} onChange={(e) => setBoltz('accelerator', e.target.value)}>
              <option value="">Auto-detect</option>
              <option value="gpu">GPU</option>
              <option value="cpu">CPU</option>
            </select>
          </div>
        </div>

        {/* Advanced */}
        <div style={{ marginTop: 20 }}>
          {advToggle}
          {advOpen && (
            <div className="adv-panel">
              <div className="field-check">
                <input type="checkbox" id="boltz-potentials" checked={p.use_potentials}
                  onChange={(e) => setBoltz('use_potentials', e.target.checked)} />
                <label htmlFor="boltz-potentials" className="field-check-label">
                  Use Potentials <Tip text="Enable potential energy terms during diffusion. Can improve physical plausibility of predicted structures." />
                </label>
              </div>
              <div className="field-check">
                <input type="checkbox" id="boltz-pae" checked={p.write_full_pae}
                  onChange={(e) => setBoltz('write_full_pae', e.target.checked)} />
                <label htmlFor="boltz-pae" className="field-check-label">
                  Write Full PAE Matrix <Tip text="Write the full Predicted Aligned Error matrix to output. Useful for assessing inter-domain and inter-chain confidence." />
                </label>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  /* ────────────────────────── Chai-1 ────────────────────────── */

  const renderChai = () => {
    const p = value.chai;
    return (
      <>
        <div className="param-grid">
          <div>
            <label className="field-label">
              Diffusion Samples <Tip text="Number of diffusion samples to generate. Each sample is an independent structure prediction." />
            </label>
            <input type="number" className="field-input" min={1} max={25} placeholder="Optional"
              value={p.num_diffn_samples} onChange={(e) => setChai('num_diffn_samples', e.target.value)} />
          </div>
          <div>
            <label className="field-label">
              Trunk Recycles <Tip text="Number of trunk recycling iterations. More recycles generally improve prediction accuracy." />
            </label>
            <input type="number" className="field-input" min={1} max={20} placeholder="Optional"
              value={p.num_trunk_recycles} onChange={(e) => setChai('num_trunk_recycles', e.target.value)} />
          </div>
          <div>
            <label className="field-label">
              Diffusion Timesteps <Tip text="Number of diffusion timesteps per sample. More steps produce smoother denoising." />
            </label>
            <input type="number" className="field-input" min={1} max={500} placeholder="Optional"
              value={p.num_diffn_timesteps} onChange={(e) => setChai('num_diffn_timesteps', e.target.value)} />
          </div>
          <div>
            <label className="field-label">
              Seed <Tip text="Random seed for reproducible predictions. Leave empty for a random seed." />
            </label>
            <input type="number" className="field-input" placeholder="Random"
              value={p.seed} onChange={(e) => setChai('seed', e.target.value)} />
          </div>
          <div>
            <label className="field-label">
              Device <Tip text="Computing device for inference. CUDA requires a compatible NVIDIA GPU." />
            </label>
            <select className="field-input" value={p.device} onChange={(e) => setChai('device', e.target.value)}>
              <option value="">Auto-detect</option>
              <option value="cuda">CUDA (GPU)</option>
              <option value="cpu">CPU</option>
            </select>
          </div>
        </div>

        {/* Advanced */}
        <div style={{ marginTop: 20 }}>
          {advToggle}
          {advOpen && (
            <div className="adv-panel">
              <div className="param-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <label className="field-label">
                    Trunk Samples <Tip text="Number of trunk samples. Controls diversity at the trunk level, separate from diffusion samples." />
                  </label>
                  <input type="number" className="field-input" placeholder="Optional"
                    value={p.num_trunk_samples} onChange={(e) => setChai('num_trunk_samples', e.target.value)} />
                </div>
                <div>
                  <label className="field-label">
                    Recycle MSA Subsample <Tip text="Number of MSA sequences to subsample per recycling iteration. Lower values reduce memory." />
                  </label>
                  <input type="number" className="field-input" placeholder="Optional"
                    value={p.recycle_msa_subsample} onChange={(e) => setChai('recycle_msa_subsample', e.target.value)} />
                </div>
                <div>
                  <label className="field-label">
                    Constraint Path <Tip text="Path to constraint JSON file for guided folding (e.g., contact maps, distance restraints)." />
                  </label>
                  <input type="text" className="field-input mono" placeholder="Optional"
                    value={p.constraint_path} onChange={(e) => setChai('constraint_path', e.target.value)} />
                </div>
                <div>
                  <label className="field-label">
                    Template Hits Path <Tip text="Path to pre-computed template hits file. Skips template search if provided." />
                  </label>
                  <input type="text" className="field-input mono" placeholder="Optional"
                    value={p.template_hits_path} onChange={(e) => setChai('template_hits_path', e.target.value)} />
                </div>
              </div>
              <div className="field-check" style={{ marginTop: 12 }}>
                <input type="checkbox" id="chai-no-esm" checked={p.no_use_esm_embeddings}
                  onChange={(e) => setChai('no_use_esm_embeddings', e.target.checked)} />
                <label htmlFor="chai-no-esm" className="field-check-label">
                  Disable ESM Embeddings <Tip text="Disable ESM2 language model embeddings. Reduces memory usage but may decrease prediction accuracy." />
                </label>
              </div>
              <div className="field-check">
                <input type="checkbox" id="chai-no-lowmem" checked={p.no_low_memory}
                  onChange={(e) => setChai('no_low_memory', e.target.checked)} />
                <label htmlFor="chai-no-lowmem" className="field-check-label">
                  Disable Low-Memory Mode <Tip text="Disable low-memory optimizations. Uses more RAM but may be faster for small inputs." />
                </label>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  /* ────────────────────────── AlphaFold 2 ────────────────────────── */

  const renderAlphaFold = () => {
    const p = value.alphafold;
    return (
      <>
        <div className="param-grid">
          <div>
            <label className="field-label">
              Model Preset <Tip text="Prediction model type. 'Monomer' for single chains, 'Multimer' for protein complexes, 'Monomer (CASP14)' for CASP14-optimized prediction." />
            </label>
            <select className="field-input" value={p.model_preset} onChange={(e) => setAlpha('model_preset', e.target.value)}>
              <option value="monomer">Monomer</option>
              <option value="monomer_casp14">Monomer (CASP14)</option>
              <option value="multimer">Multimer</option>
            </select>
          </div>
          <div>
            <label className="field-label">
              Database Preset <Tip text="Sequence database size. 'Reduced' uses Small BFD (~12 GB) for faster search. 'Full' uses BFD + UniRef30 (~2 TB) for maximum sensitivity." />
            </label>
            <select className="field-input" value={p.db_preset} onChange={(e) => setAlpha('db_preset', e.target.value)}>
              <option value="reduced_dbs">Reduced (faster)</option>
              <option value="full_dbs">Full (more sensitive)</option>
            </select>
          </div>
          <div>
            <label className="field-label">
              Max Template Date <Tip text="PDB template cutoff date, determined by the installed database snapshot. Templates released after this date are not available." />
            </label>
            <input type="text" className="field-input" value={AF_MAX_TEMPLATE_DATE} disabled
              style={{ background: '#F1F5F9', color: '#64748B' }} />
          </div>
          <div>
            <label className="field-label">
              Random Seed <Tip text="Random seed for reproducible predictions. Leave empty for a random seed." />
            </label>
            <input type="number" className="field-input" placeholder="Random"
              value={p.random_seed} onChange={(e) => setAlpha('random_seed', e.target.value)} />
          </div>
        </div>

        {/* Advanced */}
        <div style={{ marginTop: 20 }}>
          {advToggle}
          {advOpen && (
            <div className="adv-panel">
              <div className="field-check">
                <input type="checkbox" id="af-gpu-relax" checked={p.use_gpu_relax}
                  onChange={(e) => setAlpha('use_gpu_relax', e.target.checked)} />
                <label htmlFor="af-gpu-relax" className="field-check-label">
                  Use GPU Relaxation <Tip text="Use GPU for Amber energy minimization. Faster than CPU but uses additional GPU memory." />
                </label>
              </div>
              <div className="field-check">
                <input type="checkbox" id="af-precomp-msa" checked={p.use_precomputed_msas}
                  onChange={(e) => setAlpha('use_precomputed_msas', e.target.checked)} />
                <label htmlFor="af-precomp-msa" className="field-check-label">
                  Use Precomputed MSAs <Tip text="Use precomputed MSA files from the output directory. Skips database search, useful for re-running with different model parameters." />
                </label>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  /* ────────────────────────── ESMFold ────────────────────────── */

  const renderESMFold = () => {
    const p = value.esmfold;
    return (
      <>
        <div className="param-grid">
          <div>
            <label className="field-label">
              Num Recycles <Tip text="Number of recycling iterations. More recycles can improve accuracy at the cost of runtime. Default: 4." />
            </label>
            <input type="number" className="field-input" min={0} max={20} placeholder="4 (default)"
              value={p.num_recycles} onChange={(e) => setEsm('num_recycles', e.target.value)} />
          </div>
          <div>
            <label className="field-label">
              Chunk Size <Tip text="Chunk size for processing long sequences. Smaller values reduce peak memory at the cost of speed. Leave empty for automatic chunking." />
            </label>
            <input type="number" className="field-input" min={0} placeholder="Auto"
              value={p.chunk_size} onChange={(e) => setEsm('chunk_size', e.target.value)} />
          </div>
          <div>
            <label className="field-label">
              Max Tokens Per Batch <Tip text="Maximum number of tokens per batch for parallel processing. Controls memory usage when predicting multiple sequences." />
            </label>
            <input type="number" className="field-input" min={0} placeholder="Auto"
              value={p.max_tokens_per_batch} onChange={(e) => setEsm('max_tokens_per_batch', e.target.value)} />
          </div>
        </div>

        {/* Advanced */}
        <div style={{ marginTop: 20 }}>
          {advToggle}
          {advOpen && (
            <div className="adv-panel">
              <div className="field-check">
                <input type="checkbox" id="esm-cpu" checked={p.cpu_only}
                  onChange={(e) => setEsm('cpu_only', e.target.checked)} />
                <label htmlFor="esm-cpu" className="field-check-label">
                  CPU Only <Tip text="Run on CPU without GPU acceleration. Significantly slower but works without CUDA-compatible hardware." />
                </label>
              </div>
              <div className="field-check">
                <input type="checkbox" id="esm-fp16" checked={p.fp16}
                  onChange={(e) => setEsm('fp16', e.target.checked)} />
                <label htmlFor="esm-fp16" className="field-check-label">
                  Half Precision (FP16) <Tip text="Use half-precision (float16) inference. Roughly 2x faster and uses less GPU memory with minimal accuracy impact." />
                </label>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  /* ── Tool descriptions ── */
  const TOOL_DESC: Record<string, string> = {
    boltz: 'Boltz-2 \u2014 diffusion-based structure prediction with ligand and DNA/RNA support',
    chai: 'Chai-1 \u2014 hybrid architecture with strong multimer and entity support',
    alphafold: 'AlphaFold 2 \u2014 co-evolution based, gold standard for protein structures',
    esmfold: 'ESMFold \u2014 fast single-sequence prediction using protein language models',
  };

  const activeTool = (tool === 'auto' ? 'boltz' : tool) as 'boltz' | 'chai' | 'alphafold' | 'esmfold';
  const res = RESOURCE_HINTS[activeTool];

  return (
    <div>
      <h2 className="section-title">Parameters</h2>
      <p className="section-sub">{TOOL_DESC[activeTool] ?? ''}</p>

      {/* Tool-specific form */}
      {activeTool === 'boltz' && renderBoltz()}
      {activeTool === 'chai' && renderChai()}
      {activeTool === 'alphafold' && renderAlphaFold()}
      {activeTool === 'esmfold' && renderESMFold()}

      {/* MSA input — same layout as protein sequence (Boltz, Chai shown active; AlphaFold grayed out) */}
      {MSA_TOOLS.has(activeTool) && onMsaChange && onMsaFileSelect && onBrowseMsa && (() => {
        const msaDisabled = MSA_DISABLED_TOOLS.has(activeTool);
        return (
          <div style={{ marginTop: 28, ...(msaDisabled ? { opacity: 0.45, pointerEvents: 'none' } : {}) }}>
            <SequenceInput
              title="Multiple Sequence Alignment"
              subtitle={msaDisabled
                ? 'AlphaFold 2 generates its own MSAs from installed databases. Use the "Use Precomputed MSAs" option in Advanced to reuse a prior run.'
                : 'Optional \u2014 provide a precomputed MSA file (.a3m, .sto, .pqt) to improve prediction accuracy'}
              accept=".a3m,.sto,.pqt,.parquet,.a2m"
              placeholder={'>alignment_header\nMASEQ...\n>homolog_1\nMASDQ...'}
              dropHint="Drop .a3m, .sto, or .pqt file here or"
              value={msaValue ?? ''}
              onChange={onMsaChange}
              onFileSelect={onMsaFileSelect}
              onWorkspaceSelect={onBrowseMsa}
            />
          </div>
        );
      })()}

      {/* Resource estimate */}
      {res && (
        <div className="resource-bar">
          <div>
            <strong>Estimated Resources: </strong>
            <span>{res.text}</span>
          </div>
          <span className="badge b-blue">{res.badge} partition</span>
        </div>
      )}

      {/* Output folder */}
      <div style={{ marginTop: 20 }}>
        <label className="field-label">
          Output Folder <Tip text="Workspace directory where prediction results will be saved." />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="field-input mono"
            style={{ flex: 1 }}
            value={value.outputFolder}
            onChange={(e) => onChange({ ...value, outputFolder: e.target.value })}
          />
          <button type="button" className="btn-outline" onClick={onBrowseOutput}>Browse</button>
        </div>
      </div>
    </div>
  );
}

export { DEFAULTS as DEFAULT_PARAMS, CWL_FILE_INPUT };
