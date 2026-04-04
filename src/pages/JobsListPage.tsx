import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listSubmissions, type SubmissionState } from '../api/gowe';
import JobStatusBadge from '../components/JobStatusBadge';
import { useSettings, CWL_TOOLS, CWL_REPORT_WORKFLOWS } from '../hooks/useSettings';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

const STATE_FILTERS: Array<{ value: SubmissionState | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
];

/** Display names for tool workflows. */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  'protein-structure-prediction': 'Structure Prediction',
  'predict-structure': 'Predict Structure',
  alphafold: 'AlphaFold',
  boltz: 'Boltz',
  chai: 'Chai',
  esmfold: 'ESMFold',
  'protein-compare': 'Protein Compare',
  'select-structure': 'Select Structure',
};

/** Display names for report workflows. */
const REPORT_DISPLAY_NAMES: Record<string, string> = {
  'predict-report': 'Predict Report',
  'alphafold-report': 'AlphaFold Report',
  'boltz-report': 'Boltz Report',
  'boltz-report-msa': 'Boltz Report MSA',
  'chai-report': 'Chai Report',
  'esmfold-report': 'ESMFold Report',
};

/** Combined display name lookup for all known workflows. */
const ALL_DISPLAY_NAMES: Record<string, string> = { ...TOOL_DISPLAY_NAMES, ...REPORT_DISPLAY_NAMES };

const TOOL_WORKFLOW_FILTERS = [
  { value: 'all' as const, label: 'All' },
  ...CWL_TOOLS.map((id) => ({ value: id, label: TOOL_DISPLAY_NAMES[id] ?? id })),
];

const REPORT_WORKFLOW_FILTERS = CWL_REPORT_WORKFLOWS.map((id) => ({
  value: id,
  label: REPORT_DISPLAY_NAMES[id] ?? id,
}));

function toolDisplayName(sub: { workflow_name?: string; inputs?: Record<string, unknown> }): string {
  const wfName = sub.workflow_name ?? '';

  // Unified workflows — show the selected tool from inputs if available
  if (wfName === 'protein-structure-prediction' || wfName === 'predict-structure') {
    const tool = sub.inputs?.tool;
    if (typeof tool === 'string' && tool !== 'auto' && TOOL_DISPLAY_NAMES[tool]) {
      return TOOL_DISPLAY_NAMES[tool];
    }
    return TOOL_DISPLAY_NAMES[wfName] ?? wfName;
  }

  // Direct tool match (alphafold, boltz, chai, esmfold, protein-compare, select-structure)
  if (TOOL_DISPLAY_NAMES[wfName]) {
    return TOOL_DISPLAY_NAMES[wfName];
  }

  // Report workflow — extract tool part and look up
  if (wfName.endsWith('-report') || wfName.includes('-report-')) {
    const toolPart = wfName.replace(/-report(?:-.*)?$/, '');
    if (TOOL_DISPLAY_NAMES[toolPart]) return TOOL_DISPLAY_NAMES[toolPart];
  }

  // Fallback: check inputs.tool regardless of workflow
  const tool = sub.inputs?.tool;
  if (typeof tool === 'string' && TOOL_DISPLAY_NAMES[tool]) {
    return TOOL_DISPLAY_NAMES[tool];
  }

  return '-';
}

export default function JobsListPage() {
  const { workflowMode } = useSettings();
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [stateFilter, setStateFilter] = useState<SubmissionState | 'all'>('all');
  const [workflowFilter, setWorkflowFilter] = useState<string>('all');

  // When "all" is selected, don't pass workflow_id to the API
  const apiWorkflowId = workflowFilter !== 'all' ? workflowFilter : undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ['submissions', offset, pageSize, stateFilter, apiWorkflowId, workflowMode],
    queryFn: () =>
      listSubmissions({
        limit: pageSize,
        offset,
        state: stateFilter === 'all' ? undefined : stateFilter,
        workflow_id: apiWorkflowId,
      }),
    refetchInterval: 10000,
  });

  const submissions = data?.data ?? [];

  const loaded = !isLoading && !error;

  const paginationBar = (
    <div style={{ padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <button
        className="btn-outline btn-sm"
        disabled={offset === 0}
        onClick={() => setOffset(Math.max(0, offset - pageSize))}
      >
        Previous
      </button>
      <span style={{ fontSize: 12, color: '#94A3B8' }}>
        {submissions.length > 0
          ? <>Showing {offset + 1}&ndash;{offset + submissions.length}</>
          : 'No results'}
      </span>
      <button
        className="btn-outline btn-sm"
        disabled={submissions.length < pageSize}
        onClick={() => setOffset(offset + pageSize)}
      >
        Next
      </button>
    </div>
  );

  return (
    <div className="container">
      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="section-title" style={{ marginBottom: 0 }}>Jobs</h2>
            <span style={{ fontSize: 12, color: '#94A3B8' }}>
              {workflowMode === 'unified' ? 'predict-structure' : 'per-tool workflows'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748B' }}>
              Entries per page
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setOffset(0); }}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #E2E8F0', fontSize: 12, background: '#fff' }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <Link to="/folding/submit" className="btn-primary btn-sm">New Job</Link>
          </div>
        </div>

        {/* State filter pills */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="pills">
            {STATE_FILTERS.map((f) => (
              <button
                key={f.value}
                className={`pill${stateFilter === f.value ? ' active' : ''}`}
                onClick={() => { setStateFilter(f.value); setOffset(0); }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Workflow filter pills — tools */}
        <div style={{ padding: '12px 24px 4px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#94A3B8', minWidth: 40 }}>Tools</span>
          <div className="pills">
            {TOOL_WORKFLOW_FILTERS.map((f) => (
              <button
                key={f.value}
                className={`pill${workflowFilter === f.value ? ' active' : ''}`}
                onClick={() => { setWorkflowFilter(f.value); setOffset(0); }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {/* Workflow filter pills — reports */}
        <div style={{ padding: '4px 24px 12px', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#94A3B8', minWidth: 40 }}>Reports</span>
          <div className="pills">
            {REPORT_WORKFLOW_FILTERS.map((f) => (
              <button
                key={f.value}
                className={`pill${workflowFilter === f.value ? ' active' : ''}`}
                onClick={() => { setWorkflowFilter(f.value); setOffset(0); }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Top pagination bar (always visible when loaded) */}
        {loaded && (
          <div style={{ borderBottom: '1px solid #E2E8F0' }}>{paginationBar}</div>
        )}

        {/* Table content / error / loading / empty */}
        {error ? (
          <div className="error-banner" style={{ margin: 24 }}>
            {error instanceof Error ? error.message : 'Failed to load jobs'}
          </div>
        ) : isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading...</div>
        ) : submissions.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
            No jobs found. <Link to="/folding/submit" className="link-text">Submit one?</Link>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Name</th>
                <th>Workflow</th>
                <th>Tool</th>
                <th>State</th>
                <th>Submitted</th>
                <th>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((sub) => (
                <tr key={sub.id}>
                  <td>
                    <Link to={`/folding/jobs/${sub.id}`} className="link-text">
                      <code>{sub.id.slice(0, 12)}</code>
                    </Link>
                  </td>
                  <td>{sub.labels?.run_name ?? '-'}</td>
                  <td>
                    <a href={`https://gowe.software-smithy.org/api/v1/workflows/${sub.workflow_id}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>
                      <code>{ALL_DISPLAY_NAMES[sub.workflow_name] ?? sub.workflow_name ?? sub.workflow_id}</code>
                    </a>
                  </td>
                  <td>{toolDisplayName(sub)}</td>
                  <td><JobStatusBadge state={sub.state} /></td>
                  <td>{new Date(sub.created_at).toLocaleDateString()}</td>
                  <td>
                    {sub.completed_at
                      ? formatDuration(new Date(sub.completed_at).getTime() - new Date(sub.created_at).getTime())
                      : sub.state === 'running'
                        ? 'In progress'
                        : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Bottom pagination bar (always visible when loaded) */}
        {loaded && (
          <div style={{ borderTop: '1px solid #E2E8F0' }}>{paginationBar}</div>
        )}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
