import { useState } from 'react';
import type { ToolId } from './ToolSelector';

export interface PredictionParams {
  numSamples: number;
  numRecycles: number;
  outputFormat: string;
  samplingSteps: number;
  seed: string;
  device: string;
  passthrough: string;
  msaMode: 'none' | 'server' | 'upload';
  outputFolder: string;
}

const DEFAULTS: PredictionParams = {
  numSamples: 5,
  numRecycles: 3,
  outputFormat: 'pdb',
  samplingSteps: 200,
  seed: '',
  device: 'auto',
  passthrough: '',
  msaMode: 'none',
  outputFolder: '/user@bvbrc/home/StructurePrediction/',
};

const RESOURCE_HINTS: Record<string, string> = {
  auto: 'Depends on auto-selected tool',
  boltz: '8 CPU, 64 GB, A100/H100/H200 GPU, ~2h',
  chai: '8 CPU, 64 GB, A100/H100/H200 GPU, ~1.5h',
  alphafold: '8 CPU, 64 GB, A100/H100/H200 GPU, ~3h',
  esmfold: '8 CPU, 32 GB, GPU optional, ~15 min',
};

interface Props {
  tool: ToolId;
  value: PredictionParams;
  onChange: (params: PredictionParams) => void;
}

export default function ParameterForm({ tool, value, onChange }: Props) {
  const [advOpen, setAdvOpen] = useState(false);
  const set = <K extends keyof PredictionParams>(key: K, val: PredictionParams[K]) =>
    onChange({ ...value, [key]: val });

  return (
    <div>
      {/* Core parameters */}
      <h2 className="section-title">Parameters</h2>
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
            {tool === 'esmfold' ? 'N/A for ESMFold (deterministic)' : 'More samples = better coverage, slower'}
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
          <div className="field-hint">Default: 3 (ESMFold: 4)</div>
        </div>
        <div>
          <label className="field-label">Output Format</label>
          <select
            className="field-input"
            value={value.outputFormat}
            onChange={(e) => set('outputFormat', e.target.value)}
          >
            <option value="pdb">PDB + mmCIF</option>
            <option value="pdb-only">PDB only</option>
            <option value="mmcif-only">mmCIF only</option>
          </select>
        </div>
      </div>

      {/* MSA options (hidden for ESMFold) */}
      {tool !== 'esmfold' && (
        <div style={{ marginTop: 20 }}>
          <h2 className="section-title">Multiple Sequence Alignment</h2>
          <p className="section-sub">Provide precomputed MSA or generate one server-side</p>
          <div className="pills">
            {(['none', 'server', 'upload'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`pill${value.msaMode === m ? ' active' : ''}`}
                onClick={() => set('msaMode', m)}
              >
                {m === 'none' ? 'No MSA' : m === 'server' ? 'MSA Server' : 'Upload MSA'}
              </button>
            ))}
          </div>
          {value.msaMode === 'none' && (
            <div className="info-box">
              No MSA. Best for ESMFold; Boltz and Chai can still produce good results for well-studied proteins.
            </div>
          )}
          {value.msaMode === 'server' && (
            <div className="info-box">
              Compute MSA server-side using ColabFold MMseqs2 (Boltz, Chai) or jackhmmer (AlphaFold).
            </div>
          )}
          {value.msaMode === 'upload' && (
            <div className="info-box">
              Upload a precomputed alignment file (.a3m, .sto, .pqt). A3M will be auto-converted for Chai.
            </div>
          )}
        </div>
      )}

      {/* Advanced */}
      <div style={{ marginTop: 20 }}>
        <button type="button" className="link-btn" onClick={() => setAdvOpen(!advOpen)}>
          <span style={{ display: 'inline-block', transform: advOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
            &#9654;
          </span>{' '}
          Advanced / Tool-Specific Options
        </button>
        {advOpen && (
          <div className="adv-panel">
            <div className="param-grid">
              <div>
                <label className="field-label">Sampling Steps (Boltz/Chai)</label>
                <input
                  type="number"
                  className="field-input"
                  value={value.samplingSteps}
                  onChange={(e) => set('samplingSteps', Number(e.target.value))}
                />
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
              </div>
              <div>
                <label className="field-label">Device</label>
                <select
                  className="field-input"
                  value={value.device}
                  onChange={(e) => set('device', e.target.value)}
                >
                  <option value="auto">Auto-detect GPU</option>
                  <option value="cuda:0">cuda:0</option>
                  <option value="cuda:1">cuda:1</option>
                  <option value="cpu">CPU only</option>
                </select>
              </div>
              <div>
                <label className="field-label">Pass-through flags</label>
                <input
                  type="text"
                  className="field-input mono"
                  placeholder={`e.g. --${tool === 'auto' ? 'boltz' : tool}-use-potentials`}
                  value={value.passthrough}
                  onChange={(e) => set('passthrough', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Resource estimate */}
      <div className="resource-bar">
        <div>
          <strong>Estimated Resources: </strong>
          <span>{RESOURCE_HINTS[tool] ?? ''}</span>
        </div>
        <span className="badge b-blue">gpu2 partition</span>
      </div>

      {/* Output folder */}
      <div style={{ marginTop: 20 }}>
        <label className="field-label">Output Folder</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="field-input mono"
            style={{ flex: 1 }}
            value={value.outputFolder}
            onChange={(e) => set('outputFolder', e.target.value)}
          />
          <button type="button" className="btn-outline">Browse</button>
        </div>
      </div>
    </div>
  );
}

export { DEFAULTS as DEFAULT_PARAMS };
