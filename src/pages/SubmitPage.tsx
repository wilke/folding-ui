import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ToolSelector, { type ToolId } from '../components/ToolSelector';
import SequenceInput from '../components/SequenceInput';
import ParameterForm, { DEFAULT_PARAMS, buildPerToolCwlInputs, type PredictionParams } from '../components/ParameterForm';
import UnifiedParameterForm, { UNIFIED_DEFAULTS, buildUnifiedCwlInputs, type UnifiedParams } from '../components/UnifiedParameterForm';
import EntityInputPanel, { EMPTY_ENTITIES, wsPathToFileEntry, type EntityInputs, type FileEntry } from '../components/EntityInputPanel';
import BoltzInputBuilder, {
  EMPTY_BOLTZ_INPUT, generateBoltzYaml, needsMsaServer,
  type BoltzInputState,
} from '../components/BoltzInputBuilder';
import SubmitWizard from '../components/SubmitWizard';
import WorkspaceBrowser, { type BrowseMode } from '../components/WorkspaceBrowser';
import { submitJob } from '../api/gowe';
import { wsUploadFile, wsEnsureFolder } from '../api/workspace';
import { useAuth } from '../hooks/useAuth';
import { useSettings, UNIFIED_WORKFLOW, TOOL_WORKFLOWS } from '../hooks/useSettings';

type SubmitView = 'wizard' | 'advanced';
type BoltzMode = 'simple' | 'yaml';

type WsBrowseTarget = 'input' | 'output' | 'msa' | 'entity-dna' | 'entity-rna';

/** Preview payload displayed by dry-run mode. */
interface PreviewPayload {
  endpoint: string;
  method: string;
  body: Record<string, unknown>;
}

/** Build a CWL File reference with ws:// location for workspace paths. */
function wsFileRef(wsPath: string): Record<string, unknown> {
  return { class: 'File', location: `ws://${wsPath}` };
}

/**
 * Upload content to workspace and return a ws:// CWL File reference.
 * All pasted/uploaded content goes to ${outputFolder}input/ in the workspace.
 */
async function uploadToWs(
  inputFolder: string,
  fileName: string,
  content: string,
): Promise<Record<string, unknown>> {
  const destPath = `${inputFolder}${fileName}`;
  await wsUploadFile(destPath, content);
  return wsFileRef(destPath);
}

/** Resolve a FileEntry (paste/upload/workspace) to a CWL File reference. */
async function resolveFileEntry(entry: FileEntry, inputFolder: string): Promise<Record<string, unknown>> {
  if (entry.source === 'workspace') {
    return wsFileRef(entry.wsPath!);
  }
  if (entry.source === 'upload') {
    const content = await entry.file!.text();
    return uploadToWs(inputFolder, entry.file!.name, content);
  }
  // paste
  return uploadToWs(inputFolder, entry.name, entry.content!);
}

/** Preview-mode file ref — describes what would be uploaded without actually uploading. */
function previewFileRef(description: string, name: string, size?: number): Record<string, unknown> {
  const ref: Record<string, unknown> = { class: 'File', _preview: description, name };
  if (size !== undefined) ref.size = size;
  return ref;
}

/** Preview-mode resolve for a FileEntry — no side effects. */
function previewResolveEntry(entry: FileEntry, inputFolder: string): Record<string, unknown> {
  if (entry.source === 'workspace') {
    return wsFileRef(entry.wsPath!);
  }
  if (entry.source === 'upload') {
    return previewFileRef(`will upload to ws://${inputFolder}${entry.file!.name}`, entry.file!.name, entry.file!.size);
  }
  // paste
  return previewFileRef(`will upload to ws://${inputFolder}${entry.name}`, entry.name, entry.content?.length ?? 0);
}

export default function SubmitPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { workflowMode } = useSettings();
  const isUnified = workflowMode === 'unified';

  const defaultOutputFolder = user
    ? `/${user.username}/home/StructurePrediction/`
    : '/user@bvbrc/home/StructurePrediction/';

  const [tool, setTool] = useState<ToolId>(isUnified ? 'auto' : 'boltz');
  const [sequence, setSequence] = useState('>1CRN_Crambin\nTTCCPSIVARSNFNVCRLPGTPEAICATYTGCIIIPGATCPGDYAN');

  // Per-tool mode params
  const [perToolParams, setPerToolParams] = useState<PredictionParams>(() => ({
    ...DEFAULT_PARAMS,
    outputFolder: defaultOutputFolder,
  }));

  // Unified mode params (maps 1:1 to CWL inputs)
  const [unifiedParams, setUnifiedParams] = useState<UnifiedParams>(() => ({
    ...UNIFIED_DEFAULTS,
    outputDir: defaultOutputFolder,
  }));

  // Additional molecular entities (unified mode only)
  const [entities, setEntities] = useState<EntityInputs>(EMPTY_ENTITIES);

  // Boltz YAML builder state (per-tool mode only)
  const [boltzMode, setBoltzMode] = useState<BoltzMode>('simple');
  const [boltzInput, setBoltzInput] = useState<BoltzInputState>(EMPTY_BOLTZ_INPUT);

  // MSA value (unified mode only) — same pattern as sequence
  const [msaValue, setMsaValue] = useState('');

  // View mode (wizard vs advanced)
  const [submitView, setSubmitView] = useState<SubmitView>('wizard');

  const [wsBrowserOpen, setWsBrowserOpen] = useState(false);
  const [wsBrowseTarget, setWsBrowseTarget] = useState<WsBrowseTarget>('input');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewPayload | null>(null);

  // Workspace browser mode: file for input/msa/entities, folder for output
  const wsBrowseMode: BrowseMode = wsBrowseTarget === 'output' ? 'folder' : 'file';

  const handleFileSelect = async (file: File) => {
    const text = await file.text();
    setSequence(text);
  };

  const openWsBrowser = (target: WsBrowseTarget) => {
    if (!isAuthenticated) {
      navigate('/folding/login');
      return;
    }
    setWsBrowseTarget(target);
    setWsBrowserOpen(true);
  };

  const handleWorkspaceSelect = (path: string) => {
    switch (wsBrowseTarget) {
      case 'input':
        setSequence(`workspace://${path}`);
        break;
      case 'output':
        if (isUnified) {
          setUnifiedParams((p) => ({ ...p, outputDir: path }));
        } else {
          setPerToolParams((p) => ({ ...p, outputFolder: path }));
        }
        break;
      case 'msa':
        setMsaValue(`workspace://${path}`);
        break;
      case 'entity-dna':
        setEntities((prev) => ({
          ...prev,
          dnas: [...prev.dnas, wsPathToFileEntry(path)],
        }));
        break;
      case 'entity-rna':
        setEntities((prev) => ({
          ...prev,
          rnas: [...prev.rnas, wsPathToFileEntry(path)],
        }));
        break;
    }
    setWsBrowserOpen(false);
  };

  // Check if there's at least one input entity
  const isBoltzYaml = !isUnified && tool === 'boltz' && boltzMode === 'yaml';
  const hasInput = isUnified
    ? (sequence.trim() ||
       entities.proteins.length > 0 || entities.dnas.length > 0 ||
       entities.rnas.length > 0 || entities.ligands.length > 0 ||
       entities.smiles.length > 0 || entities.glycans.length > 0)
    : isBoltzYaml
      ? boltzInput.proteins.some((p) => p.sequence.trim())
      : sequence.trim();

  /** Build a preview payload (no uploads, no API call). */
  const buildPreview = () => {
    let workflowId: string;
    let inputs: Record<string, unknown>;

    const outputFolder = isUnified ? unifiedParams.outputDir : perToolParams.outputFolder;
    const outputDestination = `ws://${outputFolder}`;
    const inputFolder = `${outputFolder}input/`;

    if (isUnified) {
      workflowId = UNIFIED_WORKFLOW;

      const proteinRefs: Record<string, unknown>[] = [];
      if (sequence.trim()) {
        if (sequence.startsWith('workspace://')) {
          proteinRefs.push(wsFileRef(sequence.replace('workspace://', '')));
        } else {
          proteinRefs.push(previewFileRef(`will upload to ws://${inputFolder}protein.fasta`, 'protein.fasta', sequence.length));
        }
      }

      const dnaRefs = entities.dnas.map((e) => previewResolveEntry(e, inputFolder));
      const rnaRefs = entities.rnas.map((e) => previewResolveEntry(e, inputFolder));

      let msaRef: Record<string, unknown> | undefined;
      if (msaValue.trim()) {
        if (msaValue.startsWith('workspace://')) {
          msaRef = wsFileRef(msaValue.replace('workspace://', ''));
        } else {
          msaRef = previewFileRef(`will upload to ws://${inputFolder}msa.a3m`, 'msa.a3m', msaValue.length);
        }
      }

      inputs = buildUnifiedCwlInputs(tool, unifiedParams, {
        protein: proteinRefs.length > 0 ? proteinRefs : undefined,
        dna: dnaRefs.length > 0 ? dnaRefs : undefined,
        rna: rnaRefs.length > 0 ? rnaRefs : undefined,
        ligand: entities.ligands.length > 0 ? entities.ligands : undefined,
        smiles: entities.smiles.length > 0 ? entities.smiles : undefined,
        glycan: entities.glycans.length > 0 ? entities.glycans : undefined,
        msa: msaRef,
      });
    } else if (isBoltzYaml) {
      const yaml = generateBoltzYaml(boltzInput);
      const inputRef = previewFileRef(`will upload to ws://${inputFolder}input.yaml`, 'input.yaml', yaml.length);

      workflowId = TOOL_WORKFLOWS[tool] ?? tool;
      inputs = buildPerToolCwlInputs(tool, perToolParams, inputRef);

      if (needsMsaServer(boltzInput)) {
        inputs.use_msa_server = true;
      }
      // Attach generated YAML for reference
      (inputs as Record<string, unknown>)._boltz_yaml_preview = yaml;
    } else {
      let inputRef: Record<string, unknown>;
      if (sequence.startsWith('workspace://')) {
        inputRef = wsFileRef(sequence.replace('workspace://', ''));
      } else {
        inputRef = previewFileRef(`will upload to ws://${inputFolder}input.fasta`, 'input.fasta', sequence.length);
      }

      workflowId = TOOL_WORKFLOWS[tool] ?? tool;
      inputs = buildPerToolCwlInputs(tool, perToolParams, inputRef);

      if (msaValue.trim() && (tool === 'boltz' || tool === 'chai')) {
        if (msaValue.startsWith('workspace://')) {
          inputs.msa_file = wsFileRef(msaValue.replace('workspace://', ''));
        } else {
          inputs.msa_file = previewFileRef(`will upload to ws://${inputFolder}msa.a3m`, 'msa.a3m', msaValue.length);
        }
      }
    }

    setPreviewData({
      endpoint: 'POST /folding/api/v1/submissions',
      method: 'submitJob()',
      body: {
        workflow_id: workflowId,
        inputs,
        output_destination: outputDestination,
        labels: {
          run_name: `${tool}_${new Date().toISOString().slice(0, 10)}`,
          tool,
          workflow_mode: workflowMode,
        },
      },
    });
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      navigate('/folding/login');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      let workflowId: string;
      let inputs: Record<string, unknown>;

      // Determine workspace output destination (ws:// URI)
      const outputFolder = isUnified ? unifiedParams.outputDir : perToolParams.outputFolder;
      const outputDestination = `ws://${outputFolder}`;
      const inputFolder = `${outputFolder}input/`;

      // Ensure the input folder exists before uploading files
      await wsEnsureFolder(inputFolder);

      if (isUnified) {
        workflowId = UNIFIED_WORKFLOW;

        // Resolve primary protein sequence to CWL File reference
        const proteinRefs: Record<string, unknown>[] = [];
        if (sequence.trim()) {
          if (sequence.startsWith('workspace://')) {
            proteinRefs.push(wsFileRef(sequence.replace('workspace://', '')));
          } else {
            proteinRefs.push(await uploadToWs(inputFolder, 'protein.fasta', sequence));
          }
        }

        // Resolve DNA entries
        const dnaRefs: Record<string, unknown>[] = [];
        for (const entry of entities.dnas) {
          dnaRefs.push(await resolveFileEntry(entry, inputFolder));
        }

        // Resolve RNA entries
        const rnaRefs: Record<string, unknown>[] = [];
        for (const entry of entities.rnas) {
          rnaRefs.push(await resolveFileEntry(entry, inputFolder));
        }

        // Resolve MSA value if set
        let msaRef: Record<string, unknown> | undefined;
        if (msaValue.trim()) {
          if (msaValue.startsWith('workspace://')) {
            msaRef = wsFileRef(msaValue.replace('workspace://', ''));
          } else {
            msaRef = await uploadToWs(inputFolder, 'msa.a3m', msaValue);
          }
        }

        // Build CWL inputs with entity arrays
        inputs = buildUnifiedCwlInputs(tool, unifiedParams, {
          protein: proteinRefs.length > 0 ? proteinRefs : undefined,
          dna: dnaRefs.length > 0 ? dnaRefs : undefined,
          rna: rnaRefs.length > 0 ? rnaRefs : undefined,
          ligand: entities.ligands.length > 0 ? entities.ligands : undefined,
          smiles: entities.smiles.length > 0 ? entities.smiles : undefined,
          glycan: entities.glycans.length > 0 ? entities.glycans : undefined,
          msa: msaRef,
        });
      } else if (isBoltzYaml) {
        // Per-tool Boltz YAML builder mode: generate YAML from entity state
        const yaml = generateBoltzYaml(boltzInput);
        const inputRef = await uploadToWs(inputFolder, 'input.yaml', yaml);

        workflowId = TOOL_WORKFLOWS[tool] ?? tool;
        inputs = buildPerToolCwlInputs(tool, perToolParams, inputRef);

        // If any protein uses MSA server mode, add the flag
        if (needsMsaServer(boltzInput)) {
          inputs.use_msa_server = true;
        }
      } else {
        // Per-tool mode: single input file (simple FASTA)
        let inputRef: Record<string, unknown>;
        if (sequence.startsWith('workspace://')) {
          inputRef = wsFileRef(sequence.replace('workspace://', ''));
        } else {
          inputRef = await uploadToWs(inputFolder, 'input.fasta', sequence);
        }

        workflowId = TOOL_WORKFLOWS[tool] ?? tool;
        inputs = buildPerToolCwlInputs(tool, perToolParams, inputRef);

        // Resolve MSA file if provided (Boltz, Chai only — AlphaFold generates its own MSAs)
        if (msaValue.trim() && (tool === 'boltz' || tool === 'chai')) {
          let msaFileRef: Record<string, unknown>;
          if (msaValue.startsWith('workspace://')) {
            msaFileRef = wsFileRef(msaValue.replace('workspace://', ''));
          } else {
            msaFileRef = await uploadToWs(inputFolder, 'msa.a3m', msaValue);
          }
          inputs.msa_file = msaFileRef;
        }
      }

      const submission = await submitJob({
        workflow_id: workflowId,
        inputs,
        output_destination: outputDestination,
        labels: {
          run_name: `${tool}_${new Date().toISOString().slice(0, 10)}`,
          tool,
          workflow_mode: workflowMode,
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
    setTool(isUnified ? 'auto' : 'boltz');
    setSequence('');
    if (isUnified) {
      setUnifiedParams({ ...UNIFIED_DEFAULTS, outputDir: defaultOutputFolder });
      setEntities(EMPTY_ENTITIES);
      setMsaValue('');
    } else {
      setPerToolParams({ ...DEFAULT_PARAMS, outputFolder: defaultOutputFolder });
      setBoltzInput(EMPTY_BOLTZ_INPUT);
      setBoltzMode('simple');
      setMsaValue('');
    }
    setError(null);
  };

  return (
    <div className="container">
      <div className="gradient-hdr" style={{ borderRadius: '16px 16px 0 0' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff' }}>Predict Structure</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--accent-on-dark)' }}>
          {isUnified
            ? 'Unified prediction \u2014 Boltz-2 \u00b7 Chai-1 \u00b7 AlphaFold 2 \u00b7 ESMFold'
            : 'Per-tool workflows \u2014 full control over tool-specific parameters'}
        </p>
      </div>

      <div className="card" style={{ borderRadius: '0 0 16px 16px', padding: '24px 32px' }}>
        {/* View mode toggle (unified mode only) */}
        {isUnified && (
          <div className="view-toggle">
            <button
              type="button"
              className={`view-toggle-btn${submitView === 'wizard' ? ' active' : ''}`}
              onClick={() => setSubmitView('wizard')}
            >
              Guided
            </button>
            <button
              type="button"
              className={`view-toggle-btn${submitView === 'advanced' ? ' active' : ''}`}
              onClick={() => setSubmitView('advanced')}
            >
              Advanced
            </button>
          </div>
        )}

        {/* Wizard view (unified mode) */}
        {isUnified && submitView === 'wizard' ? (
          <SubmitWizard
            sequence={sequence}
            onSequenceChange={setSequence}
            onSequenceFileSelect={handleFileSelect}
            onSequenceWorkspaceSelect={() => openWsBrowser('input')}
            entities={entities}
            onEntitiesChange={setEntities}
            onEntityBrowse={(type) => openWsBrowser(`entity-${type}` as WsBrowseTarget)}
            msaValue={msaValue}
            onMsaChange={setMsaValue}
            onMsaFileSelect={async (f) => { const t = await f.text(); setMsaValue(t); }}
            onBrowseMsa={() => openWsBrowser('msa')}
            tool={tool}
            onToolChange={setTool}
            params={unifiedParams}
            onParamsChange={setUnifiedParams}
            onBrowseOutput={() => openWsBrowser('output')}
            onSubmit={handleSubmit}
            onPreview={buildPreview}
            previewData={previewData}
            onDismissPreview={() => setPreviewData(null)}
            submitting={submitting}
            error={error}
          />
        ) : (
          <>
            {/* Advanced view — tool selection */}
            <h2 className="section-title">Prediction Tool</h2>
            <p className="section-sub">
              {isUnified
                ? 'Choose a tool or let the system auto-select based on your input'
                : 'Select the prediction tool to use'}
            </p>
            <ToolSelector value={tool} onChange={setTool} />

            {/* Boltz mode toggle (per-tool mode, Boltz selected) */}
            {!isUnified && tool === 'boltz' && (
              <div className="boltz-mode-toggle">
                <button type="button" className={`boltz-mode-btn${boltzMode === 'simple' ? ' active' : ''}`}
                  onClick={() => setBoltzMode('simple')}>Simple FASTA</button>
                <button type="button" className={`boltz-mode-btn${boltzMode === 'yaml' ? ' active' : ''}`}
                  onClick={() => setBoltzMode('yaml')}>YAML Builder</button>
              </div>
            )}

            {/* Input section — mode-dependent */}
            {isBoltzYaml ? (
              <BoltzInputBuilder value={boltzInput} onChange={setBoltzInput} />
            ) : (
              <>
                <SequenceInput
                  value={sequence}
                  onChange={setSequence}
                  onFileSelect={handleFileSelect}
                  onWorkspaceSelect={() => openWsBrowser('input')}
                  title={isUnified ? 'Protein Sequence' : undefined}
                  subtitle={isUnified ? 'Primary protein FASTA sequence for structure prediction' : undefined}
                />

                {/* Additional entities (unified mode only) */}
                {isUnified && (
                  <EntityInputPanel
                    value={entities}
                    onChange={setEntities}
                    onBrowseWorkspace={(type) => openWsBrowser(`entity-${type}` as WsBrowseTarget)}
                  />
                )}
              </>
            )}

            {/* Parameters — mode-dependent */}
            <div style={{ marginTop: 28 }}>
              {isUnified ? (
                <UnifiedParameterForm
                  tool={tool}
                  value={unifiedParams}
                  onChange={setUnifiedParams}
                  onBrowseOutput={() => openWsBrowser('output')}
                  msaValue={msaValue}
                  onMsaChange={setMsaValue}
                  onMsaFileSelect={async (f) => { const t = await f.text(); setMsaValue(t); }}
                  onBrowseMsa={() => openWsBrowser('msa')}
                  hasNonProteinEntities={
                    entities.dnas.length > 0 || entities.rnas.length > 0 ||
                    entities.ligands.length > 0 || entities.smiles.length > 0 ||
                    entities.glycans.length > 0
                  }
                />
              ) : (
                <ParameterForm
                  tool={tool}
                  value={perToolParams}
                  onChange={setPerToolParams}
                  onBrowseOutput={() => openWsBrowser('output')}
                  msaValue={msaValue}
                  onMsaChange={setMsaValue}
                  onMsaFileSelect={async (f) => { const t = await f.text(); setMsaValue(t); }}
                  onBrowseMsa={() => openWsBrowser('msa')}
                />
              )}
            </div>

            {error && <div className="error-banner" style={{ marginTop: 16 }}>{error}</div>}

            <div style={{ marginTop: 28, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="btn-outline" onClick={handleReset}>Reset</button>
              <button
                type="button"
                className="btn-outline"
                onClick={buildPreview}
                disabled={!hasInput}
              >
                Preview
              </button>
              <button
                type="button"
                className="btn-submit"
                onClick={() => { setPreviewData(null); handleSubmit(); }}
                disabled={submitting || !hasInput}
              >
                {submitting ? 'Submitting...' : 'Submit Job'}
              </button>
            </div>

            {previewData && (
              <div className="preview-panel">
                <div className="preview-panel-header">
                  <span className="preview-panel-title">Submission Preview</span>
                  <button type="button" className="btn-close" onClick={() => setPreviewData(null)}>&times;</button>
                </div>
                <div className="preview-panel-endpoint">{previewData.endpoint}</div>
                <pre className="preview-panel-body">{JSON.stringify(previewData.body, null, 2)}</pre>
              </div>
            )}
          </>
        )}
      </div>

      <WorkspaceBrowser
        open={wsBrowserOpen}
        mode={wsBrowseMode}
        onSelect={handleWorkspaceSelect}
        onClose={() => setWsBrowserOpen(false)}
      />
    </div>
  );
}
