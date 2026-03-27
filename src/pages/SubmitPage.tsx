import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ToolSelector, { type ToolId } from '../components/ToolSelector';
import SequenceInput from '../components/SequenceInput';
import ParameterForm, { DEFAULT_PARAMS, type PredictionParams } from '../components/ParameterForm';
import WorkspaceBrowser from '../components/WorkspaceBrowser';
import { submitJob, uploadFile } from '../api/gowe';
import { useAuth } from '../hooks/useAuth';

export default function SubmitPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [tool, setTool] = useState<ToolId>('auto');
  const [sequence, setSequence] = useState('>1CRN_Crambin\nTTCCPSIVARSNFNVCRLPGTPEAICATYTGCIIIPGATCPGDYAN');
  const [params, setParams] = useState<PredictionParams>(DEFAULT_PARAMS);
  const [wsBrowserOpen, setWsBrowserOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (file: File) => {
    const text = await file.text();
    setSequence(text);
  };

  const handleWorkspaceSelect = (path: string) => {
    setSequence(`workspace://${path}`);
    setWsBrowserOpen(false);
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      navigate('/folding/login');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      // If sequence starts with workspace://, use the path directly
      let inputRef: Record<string, unknown>;
      if (sequence.startsWith('workspace://')) {
        inputRef = { class: 'File', path: sequence.replace('workspace://', '') };
      } else {
        // Upload the sequence as a file
        const blob = new Blob([sequence], { type: 'text/plain' });
        const file = new File([blob], 'input.fasta', { type: 'text/plain' });
        const uploaded = await uploadFile(file);
        inputRef = { class: 'File', path: uploaded.path };
      }

      const submission = await submitJob({
        workflow_id: 'predict-structure',
        inputs: {
          tool: tool === 'auto' ? undefined : tool,
          input_file: inputRef,
          num_samples: params.numSamples,
          num_recycles: params.numRecycles,
          output_format: params.outputFormat,
          output_dir: params.outputFolder,
          ...(params.seed ? { seed: Number(params.seed) } : {}),
          ...(params.device !== 'auto' ? { device: params.device } : {}),
          ...(params.msaMode === 'server' ? { use_msa_server: true } : {}),
        },
        labels: {
          run_name: `${tool}_${new Date().toISOString().slice(0, 10)}`,
        },
      });

      navigate(`/folding/jobs/${submission.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setTool('auto');
    setSequence('');
    setParams(DEFAULT_PARAMS);
    setError(null);
  };

  return (
    <div className="container">
      <div className="gradient-hdr" style={{ borderRadius: '16px 16px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>P</span>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff' }}>Predict Structure</h1>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#90E0EF' }}>
              Unified protein structure prediction &mdash; Boltz-2 &middot; Chai-1 &middot; AlphaFold 2 &middot; ESMFold
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ borderRadius: '0 0 16px 16px', padding: '24px 32px' }}>
        <h2 className="section-title">Prediction Tool</h2>
        <p className="section-sub">Choose a tool or let the system auto-select based on your input</p>
        <ToolSelector value={tool} onChange={setTool} />

        <SequenceInput
          value={sequence}
          onChange={setSequence}
          onFileSelect={handleFileSelect}
          onWorkspaceSelect={() => setWsBrowserOpen(true)}
        />

        <div style={{ marginTop: 28 }}>
          <ParameterForm tool={tool} value={params} onChange={setParams} />
        </div>

        {error && <div className="error-banner" style={{ marginTop: 16 }}>{error}</div>}

        <div style={{ marginTop: 28, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-outline" onClick={handleReset}>Reset</button>
          <button
            type="button"
            className="btn-submit"
            onClick={handleSubmit}
            disabled={submitting || !sequence.trim()}
          >
            {submitting ? 'Submitting...' : 'Submit Job'}
          </button>
        </div>
      </div>

      <WorkspaceBrowser
        open={wsBrowserOpen}
        onSelect={handleWorkspaceSelect}
        onClose={() => setWsBrowserOpen(false)}
      />
    </div>
  );
}
