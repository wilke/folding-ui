import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSubmission, listTasks, getTaskLogs, type Task, type Submission } from '../api/gowe';
import { wsGet, wsGetDownloadUrl } from '../api/workspace';
import { parseOutputs, formatBytes, type ParsedOutputs, type OutputFile } from '../api/outputs';
import { useSubmissionSSE } from '../hooks/useSSE';
import JobStatusBadge from '../components/JobStatusBadge';
import StructureViewer from '../components/StructureViewer';
import PlddtChart from '../components/PlddtChart';
import PAEHeatmap from '../components/PAEHeatmap';
import ContactMapCanvas from '../components/ContactMapCanvas';
import SSSequenceBar from '../components/SSSequenceBar';
import { parseStructure } from '../utils/pdbParser';
import CompareTab from '../components/CompareTab';
import { useState, useMemo, useEffect, Fragment } from 'react';

type TabId = 'overview' | 'results' | 'compare' | 'report' | 'tasks' | 'files';

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const { submission: sseSubmission, connected } = useSubmissionSSE(id);

  const { data: restSubmission, error: loadError } = useQuery({
    queryKey: ['submission', id],
    queryFn: () => getSubmission(id!),
    enabled: !!id && !connected,
    refetchInterval: connected ? false : 5000,
    retry: 1,
  });

  const submission = sseSubmission ?? restSubmission;

  const parsed = useMemo(() => {
    if (!submission?.outputs) return null;
    return parseOutputs(submission.outputs, submission.inputs);
  }, [submission?.outputs, submission?.inputs]);

  const { data: tasks } = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => listTasks(id!),
    enabled: !!id && activeTab === 'tasks',
    refetchInterval: submission?.state === 'running' ? 5000 : false,
  });

  if (loadError && !submission) {
    const raw = loadError instanceof Error ? loadError.message : String(loadError);
    // Extract HTTP status code from "GoWe 404: ..." format
    const statusMatch = raw.match(/^GoWe (\d+):\s*/);
    const statusCode = statusMatch ? statusMatch[1] : null;
    // Try to parse the JSON body for a cleaner error message
    let errorCode: string | null = null;
    let displayMsg = raw;
    if (statusMatch) {
      const jsonPart = raw.slice(statusMatch[0].length);
      try {
        const parsed = JSON.parse(jsonPart);
        errorCode = parsed?.error?.code ?? null;
        displayMsg = parsed?.error?.message ?? jsonPart;
      } catch {
        displayMsg = jsonPart || raw;
      }
    }
    return (
      <div className="container">
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12, color: '#CBD5E1' }}>
            {statusCode === '404' ? '\u2753' : '\u26A0\uFE0F'}
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#334155' }}>
            {statusCode === '404' ? 'Job Not Found' : 'Failed to Load Job'}
          </h2>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 8 }}>
            {statusCode && <span className="badge b-red" style={{ fontSize: 12 }}>HTTP {statusCode}</span>}
            {errorCode && <span className="badge b-gray" style={{ fontSize: 12 }}>{errorCode}</span>}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#64748B', maxWidth: 480, marginInline: 'auto', wordBreak: 'break-word' }}>
            {displayMsg}
          </p>
          <div style={{ marginTop: 16 }}>
            <Link to="/folding/jobs" className="btn btn-outline" style={{ fontSize: 13 }}>
              Back to Jobs
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="container">
        <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
          Loading job {id}...
        </div>
      </div>
    );
  }

  const runtime = submission.completed_at
    ? formatDuration(new Date(submission.completed_at).getTime() - new Date(submission.created_at).getTime())
    : formatDuration(Date.now() - new Date(submission.created_at).getTime());

  const stateLC = submission.state.toLowerCase();
  const isComplete = stateLC === 'success' || stateLC === 'completed';

  // Show Results + Compare tabs for completed jobs with outputs
  const tabs: TabId[] = isComplete && parsed
    ? ['overview', 'results', 'compare', 'report', 'tasks', 'files']
    : ['overview', 'report', 'tasks', 'files'];

  const tabLabels: Record<TabId, string> = {
    overview: 'Overview',
    results: 'Results',
    compare: 'Compare',
    report: 'Report',
    tasks: 'Tasks',
    files: 'Files',
  };

  return (
    <div className="container">
      {/* Header */}
      <div className="gradient-hdr" style={{ borderRadius: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <Link to="/folding/jobs" className="btn-back">&larr; Back</Link>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>
                Job {submission.id.slice(0, 12)}
              </h1>
              <JobStatusBadge state={submission.state} />
              {connected && <span className="badge b-green" style={{ fontSize: 10 }}>LIVE</span>}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--accent-on-dark)' }}>
              {submission.labels?.run_name ?? submission.workflow_name}
              {submission.task_summary && ` \u00b7 ${submission.task_summary.total} tasks`}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--accent-on-dark)' }}>Runtime</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{runtime}</div>
          </div>
        </div>
      </div>

      {submission.task_summary && submission.task_summary.total > 0 && (
        <TaskProgressBar summary={submission.task_summary} />
      )}

      {/* Tabs */}
      <div className="pills" style={{ marginBottom: 20 }}>
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`pill${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <OverviewTab submission={submission} />}
      {activeTab === 'results' && parsed && <ResultsTab parsed={parsed} />}
      {activeTab === 'compare' && parsed && <CompareTab structureFiles={parsed.structureFiles} currentJobId={id} />}
      {activeTab === 'report' && <ReportTab parsed={parsed} isComplete={isComplete} />}
      {activeTab === 'tasks' && <TasksTab tasks={tasks ?? []} submissionId={id!} />}
      {activeTab === 'files' && <FilesTab parsed={parsed} isComplete={isComplete} />}
    </div>
  );
}

// ─── TaskProgressBar ──────────────────────────────────────────

function TaskProgressBar({ summary }: { summary: { total: number; success: number; failed: number; running: number } }) {
  const pct = (n: number) => `${(n / summary.total) * 100}%`;
  return (
    <div className="progress-bar-container">
      <div className="progress-bar">
        <div className="progress-segment success" style={{ width: pct(summary.success) }} />
        <div className="progress-segment running" style={{ width: pct(summary.running) }} />
        <div className="progress-segment failed" style={{ width: pct(summary.failed) }} />
      </div>
      <div className="progress-label">
        {summary.success}/{summary.total} tasks complete
      </div>
    </div>
  );
}

// ─── OverviewTab ──────────────────────────────────────────────

function OverviewTab({ submission }: { submission: Submission }) {
  const goweBase = 'https://gowe.software-smithy.org';
  return (
    <div className="card" style={{ padding: 24 }}>
      <h2 className="section-title">Job Details</h2>
      <div className="detail-grid">
        <div className="detail-item">
          <span className="detail-label">Workflow</span>
          <span className="detail-value">
            <a href={`${goweBase}/api/v1/workflows/${submission.workflow_id}`} target="_blank" rel="noopener noreferrer">
              <code>{submission.workflow_name ?? submission.workflow_id}</code>
            </a>
          </span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Tool</span>
          <span className="detail-value">{submission.labels?.tool ?? String(submission.inputs?.tool ?? 'auto')}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Submitted</span>
          <span className="detail-value">{new Date(submission.created_at).toLocaleString()}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Run Name</span>
          <span className="detail-value">{submission.labels?.run_name ?? '-'}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">GoWe API</span>
          <span className="detail-value" style={{ display: 'flex', gap: 12 }}>
            <a href={`${goweBase}/api/v1/submissions/${submission.id}`} target="_blank" rel="noopener noreferrer">Submission</a>
            <a href={`${goweBase}/api/v1/workflows/${submission.workflow_id}`} target="_blank" rel="noopener noreferrer">Workflow</a>
          </span>
        </div>
      </div>

      {/* Inputs / Parameters */}
      {submission.inputs && Object.keys(submission.inputs).length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#64748B' }}>
            Inputs / Parameters
          </summary>
          <pre className="preview-panel-body" style={{ marginTop: 8, borderRadius: 8 }}>{prettyJson(submission.inputs)}</pre>
        </details>
      )}

      {(submission.state === 'success' || submission.state === 'completed') && (
        <div className="info-box" style={{ marginTop: 16 }}>
          Job completed successfully. Check the <strong>Results</strong> and <strong>Report</strong> tabs.
        </div>
      )}

      {(submission.state === 'failed' || submission.state === 'cancelled') && (
        <div className="error-banner" style={{ marginTop: 16 }}>
          <strong>Job {submission.state}.</strong>
          {submission.error?.message && (
            <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.5 }}>{
              (() => {
                const msg = submission.error!.message;
                const trimmed = msg.trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                  try { return prettyJson(JSON.parse(trimmed)); } catch { /* not JSON */ }
                }
                return msg;
              })()
            }</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ResultsTab ───────────────────────────────────────────────

function ResultsTab({ parsed }: { parsed: ParsedOutputs }) {
  // Fetch PDB/CIF content from workspace
  const { data: structureData, isLoading: loadingStructure } = useQuery({
    queryKey: ['ws-structure', parsed.structurePath],
    queryFn: async () => {
      if (!parsed.structurePath) return null;
      const result = await wsGet([parsed.structurePath]);
      return result[0]?.[1] as string | null;
    },
    enabled: !!parsed.structurePath,
    staleTime: Infinity,
  });

  // Fetch confidence.json
  const { data: confidence } = useQuery({
    queryKey: ['ws-confidence', parsed.confidencePath],
    queryFn: async () => {
      if (!parsed.confidencePath) return null;
      const result = await wsGet([parsed.confidencePath]);
      const raw = result[0]?.[1];
      if (typeof raw === 'string') return JSON.parse(raw);
      return raw;
    },
    enabled: !!parsed.confidencePath,
    staleTime: Infinity,
  });

  // Fetch metadata.json
  const { data: metadata } = useQuery({
    queryKey: ['ws-metadata', parsed.metadataPath],
    queryFn: async () => {
      if (!parsed.metadataPath) return null;
      const result = await wsGet([parsed.metadataPath]);
      const raw = result[0]?.[1];
      if (typeof raw === 'string') return JSON.parse(raw);
      return raw;
    },
    enabled: !!parsed.metadataPath,
    staleTime: Infinity,
  });

  // Fetch analysis.json (from protein_compare characterize --format json)
  const { data: analysis } = useQuery({
    queryKey: ['ws-analysis', parsed.analysisPath],
    queryFn: async () => {
      if (!parsed.analysisPath) return null;
      const result = await wsGet([parsed.analysisPath]);
      const raw = result[0]?.[1];
      if (typeof raw === 'string') return JSON.parse(raw);
      return raw;
    },
    enabled: !!parsed.analysisPath,
    staleTime: Infinity,
  });

  // Extract per-residue pLDDT from analysis.json or confidence.json
  const plddtValues: number[] | null = useMemo(() => {
    if (analysis?.per_residue?.plddt) return analysis.per_residue.plddt;
    if (confidence?.plddt && Array.isArray(confidence.plddt)) return confidence.plddt;
    if (confidence?.per_residue_plddt && Array.isArray(confidence.per_residue_plddt)) return confidence.per_residue_plddt;
    return null;
  }, [analysis, confidence]);

  // Parse structure for client-side analysis (C-alpha coords for contact map)
  const parsedPdb = useMemo(() => {
    if (!structureData) return null;
    return parseStructure(structureData, parsed.structureFormat);
  }, [structureData, parsed.structureFormat]);

  // Extract PAE matrix from analysis.json
  const paeMatrix = useMemo(() => {
    const pae = analysis?.pae as Record<string, unknown> | undefined;
    if (!pae) return null;
    const m = pae.pae_matrix;
    if (Array.isArray(m) && m.length > 0 && Array.isArray(m[0])) return m as number[][];
    return null;
  }, [analysis]);

  const paeDomains = useMemo(() => {
    const pae = analysis?.pae as Record<string, unknown> | undefined;
    if (!pae?.domains) return undefined;
    const d = pae.domains;
    if (Array.isArray(d) && d.length > 0) return d as number[][];
    return undefined;
  }, [analysis]);

  // Extract SS sequence from analysis.json
  const ssSequence = useMemo(() => {
    const ss = analysis?.secondary_structure as Record<string, unknown> | undefined;
    if (!ss?.ss_sequence) return undefined;
    return ss.ss_sequence as string;
  }, [analysis]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary Metrics Grid (from analysis.json) */}
      {analysis && <AnalysisMetrics analysis={analysis} />}

      {/* 3D Structure Viewer */}
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>3D Structure</h2>
          {parsed.structurePath && (
            <DownloadButton wsPath={parsed.structurePath} label={`Download ${parsed.structureFormat.toUpperCase()}`} />
          )}
        </div>
        {loadingStructure && (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
            Loading structure from workspace...
          </div>
        )}
        {!loadingStructure && structureData && (
          <StructureViewer data={structureData} format={parsed.structureFormat} />
        )}
        {!loadingStructure && !structureData && !parsed.structurePath && (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
            No structure file found in outputs.
          </div>
        )}
      </div>

      {/* pLDDT Profile Chart */}
      {plddtValues && plddtValues.length > 0 && (
        <div className="card" style={{ padding: 24 }}>
          <SectionTitle label="Per-Residue Confidence (pLDDT)" tip={GLOSSARY.pLDDT} />
          <PlddtChart values={plddtValues} />
        </div>
      )}

      {/* Confidence & Metadata side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {/* Confidence Scores */}
        <div className="card" style={{ padding: 24, minWidth: 0 }}>
          <SectionTitle label="Confidence" tip={GLOSSARY.pLDDT} />
          {confidence ? (
            <ConfidenceDisplay data={confidence} />
          ) : (
            <div style={{ color: '#94A3B8', fontSize: 13 }}>
              {parsed.confidencePath ? 'Loading...' : 'No confidence data available.'}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="card" style={{ padding: 24, minWidth: 0 }}>
          <h2 className="section-title">Run Metadata</h2>
          {metadata ? (
            <MetadataDisplay data={metadata} />
          ) : (
            <div style={{ color: '#94A3B8', fontSize: 13 }}>
              {parsed.metadataPath ? 'Loading...' : 'No metadata available.'}
            </div>
          )}
        </div>
      </div>

      {/* Secondary Structure Bar (interactive) */}
      {ssSequence && (
        <div className="card" style={{ padding: 24 }}>
          <SectionTitle label="Secondary Structure" tip={GLOSSARY['Secondary Structure']} />
          <SSSequenceBar ssSequence={ssSequence} plddt={plddtValues ?? undefined} />
          {/* Fraction summary below the bar */}
          {analysis?.secondary_structure && (
            <div style={{ marginTop: 12 }}>
              <SSDisplay ss={analysis.secondary_structure} />
            </div>
          )}
        </div>
      )}

      {/* Contacts summary — only if no SS bar above already showed SS */}
      {!ssSequence && analysis && (analysis.secondary_structure || analysis.contacts) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {analysis.secondary_structure && (
            <div className="card" style={{ padding: 24, minWidth: 0 }}>
              <SectionTitle label="Secondary Structure" tip={GLOSSARY['Secondary Structure']} />
              <SSDisplay ss={analysis.secondary_structure} />
            </div>
          )}
          {analysis.contacts && (
            <div className="card" style={{ padding: 24, minWidth: 0 }}>
              <SectionTitle label="Contact Analysis" tip={GLOSSARY['Contact Map']} />
              <ContactsDisplay contacts={analysis.contacts} />
            </div>
          )}
        </div>
      )}

      {/* Interactive PAE Heatmap & Contact Map side by side */}
      {(paeMatrix || parsedPdb) && (
        <div style={{ display: 'grid', gridTemplateColumns: paeMatrix && parsedPdb ? '1fr 1fr' : '1fr', gap: 16 }}>
          {paeMatrix && (
            <div className="card" style={{ padding: 24, minWidth: 0 }}>
              <SectionTitle label="PAE Matrix" tip={GLOSSARY.PAE ?? 'Predicted Aligned Error — estimated distance error (in Angstroms) between every pair of residues. Low values (blue) indicate high confidence in relative positioning.'} />
              <PAEHeatmap matrix={paeMatrix} domains={paeDomains} />
            </div>
          )}
          {parsedPdb && parsedPdb.nResidues > 0 && (
            <div className="card" style={{ padding: 24, minWidth: 0 }}>
              <SectionTitle label="Contact Map" tip={GLOSSARY['Contact Map']} />
              <ContactMapCanvas
                caCoords={parsedPdb.caCoords}
                ssSequence={ssSequence}
              />
            </div>
          )}
        </div>
      )}

      {/* Contacts statistics (when we have contact map but also want the text summary) */}
      {ssSequence && analysis?.contacts && (
        <div className="card" style={{ padding: 24 }}>
          <SectionTitle label="Contact Statistics" tip={GLOSSARY['Contact Map']} />
          <ContactsDisplay contacts={analysis.contacts} />
        </div>
      )}

      {/* Sequence Composition (from analysis.json) */}
      {analysis?.sequence_composition && (
        <div className="card" style={{ padding: 24 }}>
          <SectionTitle
            label="Sequence Composition"
            tip="Distribution of residue types and molecular properties."
          />
          <SequenceCompositionDisplay comp={analysis.sequence_composition} />
        </div>
      )}

      {/* Glossary */}
      <GlossaryPanel />
    </div>
  );
}

// ─── Analysis Metrics Grid ───────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  tip?: string;
}

function MetricCard({ label, value, sub, color, tip }: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-label">
        {label}
        {tip && <span className="info-tip" data-tip={tip} style={{ marginLeft: 4 }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#94A3B8" strokeWidth="1.5"/><text x="8" y="12" textAnchor="middle" fontSize="10" fontWeight="700" fill="#94A3B8">i</text></svg>
        </span>}
      </div>
      <div className="metric-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

/** Safe number accessor for unknown JSON data. */
function num(obj: unknown, key: string): number | null {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : null;
  }
  return null;
}

function AnalysisMetrics({ analysis }: { analysis: Record<string, unknown> }) {
  const structure = analysis.structure as Record<string, unknown> | undefined;
  const conf = analysis.confidence as Record<string, unknown> | undefined;
  const seq = analysis.sequence_composition as Record<string, unknown> | undefined;
  const contacts = analysis.contacts as Record<string, unknown> | undefined;
  const ss = analysis.secondary_structure as Record<string, unknown> | undefined;
  const pae = analysis.pae as Record<string, unknown> | undefined;

  const nRes = num(structure, 'n_residues');
  const mw = num(seq, 'molecular_weight');
  const meanPlddt = num(conf, 'mean');
  const fracConf = num(conf, 'frac_confident');
  const ptm = num(pae, 'ptm');
  const meanPae = num(pae, 'mean_pae');
  const nDomains = num(pae, 'n_domains');
  const nContacts = num(contacts, 'n_contacts');
  const helixFrac = num(ss, 'helix_fraction');
  const sheetFrac = num(ss, 'sheet_fraction');
  const coilFrac = num(ss, 'coil_fraction');

  return (
    <div className="metrics-grid">
      {nRes != null && <MetricCard label="Residues" value={nRes} tip={GLOSSARY['Residue']} />}
      {mw != null && <MetricCard label="Mol. Weight" value={`${(mw / 1000).toFixed(1)} kDa`} tip={GLOSSARY['Molecular Weight']} />}
      {meanPlddt != null && (
        <MetricCard
          label="Mean pLDDT"
          value={meanPlddt.toFixed(1)}
          color={confidenceColor(meanPlddt / 100)}
          sub={conf?.is_reliable ? 'Reliable' : 'Low confidence'}
          tip={GLOSSARY['pLDDT']}
        />
      )}
      {fracConf != null && (
        <MetricCard label="Confident" value={`${(fracConf * 100).toFixed(0)}%`} sub="pLDDT >= 70" tip="Fraction of residues with pLDDT >= 70, indicating confident prediction." />
      )}
      {ptm != null && (
        <MetricCard label="pTM" value={ptm.toFixed(3)} color={confidenceColor(ptm)} tip={GLOSSARY['pTM']} />
      )}
      {meanPae != null && (
        <MetricCard label="Mean PAE" value={`${meanPae.toFixed(1)} \u00c5`} sub={nDomains != null ? `${nDomains} domain(s)` : undefined} tip={GLOSSARY['PAE']} />
      )}
      {nContacts != null && <MetricCard label="Contacts" value={nContacts} tip={GLOSSARY['Contact Map']} />}
      {helixFrac != null && sheetFrac != null && coilFrac != null && (
        <MetricCard
          label="Structure"
          value={`${(helixFrac * 100).toFixed(0)}% H`}
          tip={GLOSSARY['Secondary Structure']}
          sub={`${(sheetFrac * 100).toFixed(0)}% E · ${(coilFrac * 100).toFixed(0)}% C`}
        />
      )}
    </div>
  );
}

// ─── Secondary Structure Display ─────────────────────────────

interface SSData {
  helix_fraction: number;
  sheet_fraction: number;
  coil_fraction: number;
  helix_count: number;
  sheet_count: number;
  coil_count: number;
}

function SSDisplay({ ss }: { ss: SSData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SSBar label="Helix" pct={ss.helix_fraction} count={ss.helix_count} color="#EF4444" />
      <SSBar label="Sheet" pct={ss.sheet_fraction} count={ss.sheet_count} color="#3B82F6" />
      <SSBar label="Coil" pct={ss.coil_fraction} count={ss.coil_count} color="#94A3B8" />
      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
        {(ss.helix_fraction * 100).toFixed(1)}% helix · {(ss.sheet_fraction * 100).toFixed(1)}% sheet · {(ss.coil_fraction * 100).toFixed(1)}% coil
      </div>
    </div>
  );
}

function SSBar({ label, pct, count, color }: { label: string; pct: number; count: number; color: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
        <span style={{ fontWeight: 600, color: '#334155' }}>{label}</span>
        <span style={{ color: '#64748B' }}>{count} residues ({(pct * 100).toFixed(1)}%)</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: '#E2E8F0', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: color, borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

// ─── Contacts Display ────────────────────────────────────────

interface ContactData {
  n_contacts: number;
  contact_density: number;
  n_short_range: number;
  n_medium_range: number;
  n_long_range: number;
  n_very_long_range: number;
}

function ContactsDisplay({ contacts }: { contacts: ContactData }) {
  const total = contacts.n_contacts;
  const ranges = [
    { label: 'Short (<6)', value: contacts.n_short_range, color: '#10B981' },
    { label: 'Medium (6-12)', value: contacts.n_medium_range, color: '#3B82F6' },
    { label: 'Long (12-24)', value: contacts.n_long_range, color: '#F59E0B' },
    { label: 'Very long (>24)', value: contacts.n_very_long_range, color: '#EF4444' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <span style={{ fontWeight: 600, color: '#334155' }}>Total Contacts</span>
        <span style={{ fontWeight: 700 }}>{total}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748B' }}>
        <span>Contact Density</span>
        <span>{contacts.contact_density.toFixed(4)}</span>
      </div>
      <div style={{ marginTop: 4 }}>
        {ranges.map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '3px 0' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
              {label}
            </span>
            <span style={{ color: '#334155', fontWeight: 500 }}>
              {value} ({total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sequence Composition Display ────────────────────────────

function SequenceCompositionDisplay({ comp }: { comp: Record<string, unknown> }) {
  const typeFractions = comp.type_fractions as Record<string, number> | undefined;
  const typeCounts = comp.type_counts as Record<string, number> | undefined;
  const length = comp.length as number;
  const mw = comp.molecular_weight as number | undefined;
  const molType = (comp.molecule_type as string | undefined) ?? 'protein';
  const isDna = molType === 'dna';
  const isRna = molType === 'rna';
  const isNucleotide = isDna || isRna;

  // Residue-level counts (renamed from aa_counts/aa_fractions → residue_counts/residue_fractions)
  const residueCounts = (comp.residue_counts ?? comp.aa_counts) as Record<string, number> | undefined;
  const residueFractions = (comp.residue_fractions ?? comp.aa_fractions) as Record<string, number> | undefined;

  const proteinTypeColors: Record<string, string> = {
    hydrophobic: '#3B82F6',
    polar: '#10B981',
    positive: '#EF4444',
    negative: '#F59E0B',
    special: '#8B5CF6',
  };

  const nucleotideTypeColors: Record<string, string> = {
    purine: '#3B82F6',
    pyrimidine: '#F59E0B',
  };

  const typeColors = isNucleotide ? nucleotideTypeColors : proteinTypeColors;

  // Residue color palette for per-base/per-AA display
  const nucleotideResColors: Record<string, string> = {
    A: '#10B981', T: '#3B82F6', G: '#F59E0B', C: '#EF4444', U: '#8B5CF6',
  };
  const proteinResColors: Record<string, string> = {
    A: '#3B82F6', R: '#EF4444', N: '#10B981', D: '#F59E0B', C: '#8B5CF6',
    E: '#F59E0B', Q: '#10B981', G: '#94A3B8', H: '#3B82F6', I: '#3B82F6',
    L: '#3B82F6', K: '#EF4444', M: '#3B82F6', F: '#3B82F6', P: '#8B5CF6',
    S: '#10B981', T: '#10B981', W: '#3B82F6', Y: '#3B82F6', V: '#3B82F6',
  };
  const resColors = isNucleotide ? nucleotideResColors : proteinResColors;

  const unitLabel = isNucleotide ? 'bases' : 'residues';

  return (
    <div>
      {/* Header stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13, color: '#334155', flexWrap: 'wrap', alignItems: 'center' }}>
        {isNucleotide && (
          <span className={`badge ${isDna ? 'b-blue' : 'b-purple'}`} style={{ fontSize: 10 }}>
            {molType.toUpperCase()}
          </span>
        )}
        <span><strong>{length}</strong> {unitLabel}</span>
        {mw != null && mw > 0 && <span><strong>{(mw / 1000).toFixed(1)}</strong> kDa</span>}
        {Array.isArray(comp.chains) && <span><strong>{comp.chains.length}</strong> chain(s)</span>}
      </div>

      {/* Type distribution bar (hydrophobic/polar/... or purine/pyrimidine) */}
      {typeFractions && typeCounts && (
        <>
          <div style={{ display: 'flex', height: 20, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
            {Object.entries(typeFractions).map(([type, frac]) => (
              <div
                key={type}
                style={{
                  width: `${frac * 100}%`,
                  background: typeColors[type] ?? '#94A3B8',
                  minWidth: frac > 0 ? 2 : 0,
                }}
                title={`${type}: ${(frac * 100).toFixed(1)}%`}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, marginBottom: 12 }}>
            {Object.entries(typeFractions).map(([type, frac]) => (
              <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#64748B' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: typeColors[type] ?? '#94A3B8', display: 'inline-block' }} />
                {type} {(frac * 100).toFixed(0)}% ({typeCounts[type]})
              </span>
            ))}
          </div>
        </>
      )}

      {/* Per-residue composition (residue_counts / residue_fractions) */}
      {residueCounts && residueFractions && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6, textTransform: 'uppercase' }}>
            {isNucleotide ? 'Base Composition' : 'Amino Acid Composition'}
          </div>
          <div style={{ display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
            {Object.entries(residueFractions)
              .sort(([, a], [, b]) => b - a)
              .map(([res, frac]) => (
                <div
                  key={res}
                  style={{
                    width: `${frac * 100}%`,
                    background: resColors[res] ?? '#94A3B8',
                    minWidth: frac > 0.01 ? 2 : 0,
                  }}
                  title={`${res}: ${(frac * 100).toFixed(1)}% (${residueCounts[res] ?? 0})`}
                />
              ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10 }}>
            {Object.entries(residueCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([res, count]) => (
                <span key={res} style={{ display: 'flex', alignItems: 'center', gap: 2, color: '#64748B' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 1, background: resColors[res] ?? '#94A3B8', display: 'inline-block' }} />
                  {res}:{count}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidenceDisplay({ data }: { data: Record<string, unknown> }) {
  // Boltz confidence.json has scalar scores (ptm, iptm, confidence) and
  // per-residue arrays (plddt, pae). Separate them for proper display.
  const scalarEntries: [string, number][] = [];
  const arrayEntries: [string, number[]][] = [];

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number') {
      scalarEntries.push([key, value]);
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number') {
      arrayEntries.push([key, value as number[]]);
    }
    // Skip non-numeric objects/strings
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Scalar scores with progress bars */}
      {scalarEntries.map(([key, numVal]) => (
        <div key={key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
              {formatConfidenceLabel(key)}
            </span>
            <span style={{ fontSize: 18, fontWeight: 700, color: confidenceColor(numVal) }}>
              {numVal.toFixed(3)}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#E2E8F0', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(numVal * 100, 100)}%`,
                borderRadius: 3,
                background: confidenceColor(numVal),
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>
      ))}

      {/* Per-residue arrays — show summary (mean, min, max, count) */}
      {arrayEntries.map(([key, arr]) => {
        let sum = 0, min = Infinity, max = -Infinity;
        for (let i = 0; i < arr.length; i++) { const v = arr[i] ?? 0; sum += v; if (v < min) min = v; if (v > max) max = v; }
        const mean = sum / (arr.length || 1);
        return (
          <div key={key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                {formatConfidenceLabel(key)}
              </span>
              <span style={{ fontSize: 18, fontWeight: 700, color: confidenceColor(mean) }}>
                {mean.toFixed(3)}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: '#E2E8F0', overflow: 'hidden', marginBottom: 4 }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(mean * 100, 100)}%`,
                  borderRadius: 3,
                  background: confidenceColor(mean),
                  transition: 'width 0.3s',
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>
              mean {mean.toFixed(3)} &middot; min {min.toFixed(3)} &middot; max {max.toFixed(3)} &middot; {arr.length} residues
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatConfidenceLabel(key: string): string {
  const labels: Record<string, string> = {
    confidence: 'Overall Confidence',
    ptm: 'pTM Score',
    iptm: 'ipTM Score',
    plddt: 'pLDDT',
    pair: 'Pair Score',
    complex: 'Complex Score',
    ranking_score: 'Ranking Score',
  };
  return labels[key] ?? key.replace(/_/g, ' ');
}

function confidenceColor(value: number): string {
  if (value >= 0.9) return '#10B981';
  if (value >= 0.7) return '#3B82F6';
  if (value >= 0.5) return '#F59E0B';
  return '#EF4444';
}

function MetadataDisplay({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);

  // Separate simple key-value pairs from complex (object/array) values
  const simpleEntries: [string, string][] = [];
  const complexEntries: [string, unknown][] = [];

  for (const [key, value] of entries) {
    if (value == null) {
      simpleEntries.push([key, '-']);
    } else if (typeof value === 'object') {
      complexEntries.push([key, value]);
    } else {
      simpleEntries.push([key, String(value)]);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {simpleEntries.map(([key, display]) => (
        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B', whiteSpace: 'nowrap' }}>{key}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#0F172A', textAlign: 'right', wordBreak: 'break-word', minWidth: 0 }}>
            {display}
          </span>
        </div>
      ))}
      {complexEntries.map(([key, value]) => (
        <details key={key}>
          <summary style={{ fontSize: 12, fontWeight: 600, color: '#64748B', cursor: 'pointer' }}>
            {key} {Array.isArray(value) ? `[${(value as unknown[]).length} items]` : '{...}'}
          </summary>
          <pre className="preview-panel-body" style={{ marginTop: 4, borderRadius: 6, fontSize: 11 }}>{prettyJson(value)}</pre>
        </details>
      ))}
    </div>
  );
}

// ─── ReportTab ────────────────────────────────────────────────

function ReportTab({ parsed, isComplete }: { parsed: ParsedOutputs | null; isComplete: boolean }) {
  // Fetch HTML content via wsGet and create a blob URL for inline display
  const { data: blobUrl, isLoading } = useQuery({
    queryKey: ['ws-report-blob', parsed?.reportPath],
    queryFn: async () => {
      const result = await wsGet([parsed!.reportPath!]);
      const html = result[0]?.[1] as string | null;
      if (!html) return null;
      const blob = new Blob([html], { type: 'text/html' });
      return URL.createObjectURL(blob);
    },
    enabled: !!parsed?.reportPath,
    staleTime: Infinity,
  });

  // Revoke blob URL on unmount to prevent memory leak
  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  if (!isComplete) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
        Report will be available after the job completes.
      </div>
    );
  }

  if (!parsed?.reportPath) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
        No HTML report found in job outputs.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
        Loading report...
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
        Could not load report. The report may not be accessible.
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#64748B' }}>Structure Characterization Report</span>
        <a href={blobUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
          Open in new tab
        </a>
      </div>
      <iframe
        src={blobUrl}
        title="Structure Characterization Report"
        style={{ width: '100%', height: '80vh', border: 'none' }}
      />
    </div>
  );
}

// ─── TasksTab ─────────────────────────────────────────────────

function TasksTab({ tasks, submissionId }: { tasks: Task[]; submissionId: string }) {
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const { data: logs } = useQuery({
    queryKey: ['task-logs', submissionId, expandedTask],
    queryFn: () => getTaskLogs(submissionId, expandedTask!),
    enabled: !!expandedTask,
  });

  return (
    <div className="card" style={{ padding: 24 }}>
      <h2 className="section-title">Tasks</h2>
      {tasks.length === 0 ? (
        <div style={{ color: '#94A3B8', fontSize: 13 }}>No tasks yet.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>State</th>
              <th>Runtime</th>
              <th>Exit Code</th>
              <th>Logs</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td><code>{t.step_id}</code></td>
                  <td><span className={`badge ${taskStateBadge(t.state)}`}>{t.state}</span></td>
                  <td>{t.runtime_ms ? `${(t.runtime_ms / 1000).toFixed(1)}s` : '-'}</td>
                  <td>{t.exit_code !== undefined ? t.exit_code : '-'}</td>
                  <td>
                    <button
                      className="link-btn"
                      style={{ fontSize: 12 }}
                      onClick={() => setExpandedTask(expandedTask === t.id ? null : t.id)}
                    >
                      {expandedTask === t.id ? 'Hide' : 'Show'}
                    </button>
                  </td>
                </tr>
                {expandedTask === t.id && logs && (
                  <tr key={`${t.id}-logs`}>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <div style={{ background: '#1E293B', color: '#E2E8F0', padding: 16, fontSize: 12, fontFamily: 'monospace', maxHeight: 300, overflow: 'auto' }}>
                        {logs.stderr && (
                          <div>
                            <div style={{ color: '#F87171', fontWeight: 600, marginBottom: 4 }}>stderr:</div>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{logs.stderr}</pre>
                          </div>
                        )}
                        {logs.stdout && (
                          <div style={{ marginTop: logs.stderr ? 12 : 0 }}>
                            <div style={{ color: '#34D399', fontWeight: 600, marginBottom: 4 }}>stdout:</div>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{logs.stdout}</pre>
                          </div>
                        )}
                        {!logs.stderr && !logs.stdout && (
                          <div style={{ color: '#94A3B8' }}>No output captured.</div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── FilesTab ─────────────────────────────────────────────────

function FilesTab({ parsed, isComplete }: { parsed: ParsedOutputs | null; isComplete: boolean }) {
  if (!isComplete || !parsed) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
        Files will appear here after the job completes.
      </div>
    );
  }

  if (parsed.allFiles.length === 0 && parsed.inputFiles.length === 0) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
        No files found.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Inputs ── */}
      <div className="card" style={{ padding: 24 }}>
        <h2 className="section-title">Inputs</h2>
        <p className="section-sub">
          {parsed.inputFiles.length} file{parsed.inputFiles.length !== 1 ? 's' : ''}
        </p>
        {parsed.inputFiles.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th style={{ textAlign: 'right' }}>Parameter</th>
                <th style={{ textAlign: 'right' }}>Download</th>
              </tr>
            </thead>
            <tbody>
              {parsed.inputFiles.map((f, i) => (
                <tr key={f.wsPath ?? i}>
                  <td><code style={{ fontSize: 12 }}>{f.name}</code></td>
                  <td style={{ color: '#64748B', fontSize: 12, textAlign: 'right' }}>{f.inputKey}</td>
                  <td style={{ textAlign: 'right' }}>
                    {f.wsPath ? (
                      <DownloadButton wsPath={f.wsPath} label="Download" />
                    ) : (
                      <span style={{ fontSize: 11, color: '#CBD5E1' }}>staged</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: '#94A3B8', fontSize: 13 }}>No input files.</p>
        )}
      </div>

      {/* ── Outputs ── */}
      <div className="card" style={{ padding: 24 }}>
        <h2 className="section-title">Outputs</h2>
        <p className="section-sub">
          {parsed.allFiles.length} file{parsed.allFiles.length !== 1 ? 's' : ''}
        </p>
        {parsed.allFiles.length > 0 ? (
          <OutputsByKey files={parsed.allFiles} />
        ) : (
          <p style={{ color: '#94A3B8', fontSize: 13 }}>No output files.</p>
        )}
      </div>
    </div>
  );
}

/** Output files in a single table, with output key headers as separator rows. */
function OutputsByKey({ files }: { files: OutputFile[] }) {
  // Preserve insertion order
  const grouped = new Map<string, OutputFile[]>();
  for (const f of files) {
    const list = grouped.get(f.outputKey) ?? [];
    list.push(f);
    grouped.set(f.outputKey, list);
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>File</th>
          <th style={{ textAlign: 'right', width: 80 }}>Size</th>
          <th style={{ textAlign: 'right', width: 100 }}></th>
        </tr>
      </thead>
      <tbody>
        {[...grouped.entries()].map(([key, group]) => (
          <Fragment key={key}>
            <tr>
              <td colSpan={3} style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', paddingTop: 16, paddingBottom: 4, borderBottom: 'none' }}>
                {key.replace(/_/g, ' ')}
              </td>
            </tr>
            {group.map((f) => {
              const hasDir = f.dirPath.length > 0;
              return (
                <tr key={f.wsPath}>
                  <td>
                    {hasDir && (
                      <span style={{ fontSize: 11, color: '#94A3B8' }}>
                        {f.dirPath.join('/') + '/'}
                      </span>
                    )}
                    <code style={{ fontSize: 12 }}>{f.name}</code>
                  </td>
                  <td style={{ color: '#64748B', fontSize: 12, textAlign: 'right' }}>{formatBytes(f.size)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <DownloadButton wsPath={f.wsPath} label="Download" />
                  </td>
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

// ─── Shared: Download Button ──────────────────────────────────

function DownloadButton({ wsPath, label }: { wsPath: string; label: string }) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const url = await wsGetDownloadUrl(wsPath);
      window.open(url, '_blank');
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button className="link-btn" style={{ fontSize: 12 }} onClick={handleDownload} disabled={loading}>
      {loading ? 'Loading...' : label}
    </button>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function taskStateBadge(state: string): string {
  switch (state.toLowerCase()) {
    case 'success':
    case 'completed': return 'b-green';
    case 'failed': return 'b-red';
    case 'running': return 'b-amber';
    default: return 'b-gray';
  }
}

/** Recursively parse any stringified JSON values so they pretty-print correctly. */
function deepParseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return deepParseJson(JSON.parse(trimmed)); } catch { /* not JSON */ }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(deepParseJson);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepParseJson(v);
    return out;
  }
  return value;
}

function prettyJson(obj: unknown): string {
  return JSON.stringify(deepParseJson(obj), null, 2);
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ─── Glossary & Tooltips ─────────────────────────────────────

const GLOSSARY: Record<string, string> = {
  'pLDDT': 'Per-residue confidence score (0\u2013100) from structure prediction. \u226590 = very high, 70\u201390 = confident, 50\u201370 = low, <50 = very low confidence.',
  'B-factor': 'In experimental structures, atomic displacement/flexibility. In predicted structures, the B-factor column stores pLDDT scores instead.',
  'Contact Map': 'A 2D matrix showing residue pairs in spatial proximity (C\u03b1 distance < 8\u00c5). Off-diagonal contacts indicate 3D folding bringing distant residues together.',
  'Contact Order': 'Sequence separation between contacting residues. Short-range (<6) are local; long-range (>12) indicate complex folding.',
  'Contact Density': 'Fraction of all possible residue pairs that are in contact. Higher density = more compact, well-folded structure.',
  'Secondary Structure': 'Local 3D arrangements of the protein backbone: \u03b1-helix (H), \u03b2-sheet/strand (E), and coil/loop (C). Assigned by DSSP algorithm.',
  '\u03b1-Helix (H)': 'Right-handed spiral stabilized by backbone hydrogen bonds (i to i+4). Common structural element providing stability.',
  '\u03b2-Sheet (E)': 'Extended chain conformations forming sheets via hydrogen bonds between adjacent strands. Can be parallel or antiparallel.',
  'Coil/Loop (C)': 'Regions without regular secondary structure. Often flexible, connecting helices and sheets.',
  'DSSP': 'Define Secondary Structure of Proteins \u2014 standard algorithm assigning secondary structure from 3D coordinates based on hydrogen bonding.',
  'C\u03b1 (Alpha Carbon)': 'Central carbon in each amino acid. C\u03b1 positions define the protein backbone trace used for structural comparisons.',
  'Residue': 'A single amino acid unit within a protein chain, with a backbone (N-C\u03b1-C) and a side chain (R group).',
  'Molecular Weight': 'Total protein mass in Daltons (Da) or kiloDaltons (kDa). Sum of amino acid masses minus water lost in peptide bonds.',
  'Hydrophobic': 'Amino acids with non-polar side chains (A, V, L, I, M, F, W). Typically found in the protein core, driving folding.',
  'Polar': 'Amino acids with uncharged polar side chains (S, T, N, Q, Y, C). Can form hydrogen bonds; often on protein surfaces.',
  'Charged': 'Amino acids with ionizable side chains. Positive: K, R, H. Negative: D, E. Important for solubility and interactions.',
  'TM-score': 'Template Modeling score (0\u20131) for structural similarity, normalized by length. >0.5 = same fold.',
  'RMSD': 'Root Mean Square Deviation \u2014 average distance between aligned C\u03b1 atoms (\u00c5). Lower = more similar.',
  'PAE': 'Predicted Aligned Error \u2014 estimated position error (\u00c5) between residue pairs. Low PAE (<5\u00c5) = high confidence in relative positioning.',
  'pTM': 'Predicted TM-score (0\u20131) for overall fold confidence. >0.5 = confident prediction.',
  'ipTM': 'Interface pTM for multimer predictions. >0.8 = reliable interface prediction.',
  'Domain': 'Compact, semi-independent folding unit. Low internal PAE but potentially high PAE to other domains.',
  '\u00c5ngstr\u00f6m (\u00c5)': 'Unit of length = 10\u207b\u00b9\u2070 m (0.1 nm). Typical C-C bond \u2248 1.5\u00c5; contact cutoff = 8\u00c5.',
};

/** Section header with an info tooltip. */
function SectionTitle({ label, tip }: { label: string; tip?: string }) {
  return (
    <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {label}
      {tip && (
        <span className="info-tip" data-tip={tip}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ display: 'block' }}>
            <circle cx="8" cy="8" r="7" stroke="#94A3B8" strokeWidth="1.5" />
            <text x="8" y="12" textAnchor="middle" fontSize="10" fontWeight="700" fill="#94A3B8">i</text>
          </svg>
        </span>
      )}
    </h2>
  );
}

/** Collapsible glossary panel at the bottom of the Results tab. */
function GlossaryPanel() {
  return (
    <details className="card" style={{ padding: 0 }}>
      <summary className="glossary-header">
        Glossary of Terms
      </summary>
      <div className="glossary-grid">
        {Object.entries(GLOSSARY).map(([term, definition]) => (
          <div key={term} className="glossary-item">
            <div className="glossary-term">{term}</div>
            <div className="glossary-def">{definition}</div>
          </div>
        ))}
      </div>
    </details>
  );
}
