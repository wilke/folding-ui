import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSubmission, listTasks, type Task } from '../api/gowe';
import { useSubmissionSSE } from '../hooks/useSSE';
import JobStatusBadge from '../components/JobStatusBadge';
import { useState } from 'react';

type TabId = 'overview' | 'report' | 'tasks' | 'files';

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // SSE for live updates
  const { submission: sseSubmission, connected } = useSubmissionSSE(id);

  // Fallback: poll via REST if SSE not connected
  const { data: restSubmission } = useQuery({
    queryKey: ['submission', id],
    queryFn: () => getSubmission(id!),
    enabled: !!id && !connected,
    refetchInterval: connected ? false : 5000,
  });

  const submission = sseSubmission ?? restSubmission;

  // Tasks
  const { data: tasks } = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => listTasks(id!),
    enabled: !!id && activeTab === 'tasks',
    refetchInterval: submission?.state === 'running' ? 5000 : false,
  });

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
            <p style={{ margin: 0, fontSize: 13, color: '#90E0EF' }}>
              {submission.labels?.run_name ?? submission.workflow_name}
              {submission.task_summary && ` \u00b7 ${submission.task_summary.total} tasks`}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#90E0EF' }}>Runtime</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{runtime}</div>
          </div>
        </div>
      </div>

      {/* Task progress bar */}
      {submission.task_summary && submission.task_summary.total > 0 && (
        <TaskProgressBar summary={submission.task_summary} />
      )}

      {/* Tabs */}
      <div className="pills" style={{ marginBottom: 20 }}>
        {(['overview', 'report', 'tasks', 'files'] as const).map((tab) => (
          <button
            key={tab}
            className={`pill${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'overview' ? 'Overview' : tab === 'report' ? 'Report' : tab === 'tasks' ? 'Tasks' : 'Files'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab submission={submission} />}
      {activeTab === 'report' && <ReportTab submission={submission} />}
      {activeTab === 'tasks' && <TasksTab tasks={tasks ?? []} />}
      {activeTab === 'files' && <FilesTab submission={submission} />}
    </div>
  );
}

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

function OverviewTab({ submission }: { submission: { state: string; inputs: Record<string, unknown>; labels: Record<string, string>; created_at: string } }) {
  return (
    <div className="card" style={{ padding: 24 }}>
      <h2 className="section-title">Job Details</h2>
      <div className="detail-grid">
        <div className="detail-item">
          <span className="detail-label">Tool</span>
          <span className="detail-value">{String(submission.inputs?.tool ?? 'auto')}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Samples</span>
          <span className="detail-value">{String(submission.inputs?.num_samples ?? '-')}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Submitted</span>
          <span className="detail-value">{new Date(submission.created_at).toLocaleString()}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Run Name</span>
          <span className="detail-value">{submission.labels?.run_name ?? '-'}</span>
        </div>
      </div>
      {submission.state === 'success' && (
        <div className="info-box" style={{ marginTop: 16 }}>
          Job completed successfully. Check the Report and Files tabs for results.
        </div>
      )}
    </div>
  );
}

function ReportTab({ submission }: { submission: { state: string; outputs: Record<string, unknown> } }) {
  if (submission.state !== 'success') {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
        Report will be available after the job completes.
      </div>
    );
  }

  // The report HTML URL comes from the submission outputs or workspace
  const reportUrl = submission.outputs?.report_html as string | undefined;

  if (!reportUrl) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
        No HTML report found in job outputs.
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <iframe
        src={reportUrl}
        title="Structure Characterization Report"
        style={{ width: '100%', height: '80vh', border: 'none' }}
      />
    </div>
  );
}

function TasksTab({ tasks }: { tasks: Task[] }) {
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
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><code>{t.step_id}</code></td>
                <td><span className={`badge ${taskStateBadge(t.state)}`}>{t.state}</span></td>
                <td>{t.runtime_ms ? `${(t.runtime_ms / 1000).toFixed(1)}s` : '-'}</td>
                <td>{t.exit_code !== undefined ? t.exit_code : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FilesTab({ submission }: { submission: { outputs: Record<string, unknown> } }) {
  const outputDir = submission.outputs?.output_dir as string | undefined;

  return (
    <div className="card" style={{ padding: 24 }}>
      <h2 className="section-title">Output Files</h2>
      {outputDir ? (
        <p className="section-sub" style={{ fontFamily: 'monospace' }}>{outputDir}</p>
      ) : (
        <p className="section-sub">Files will appear here after the job completes.</p>
      )}
    </div>
  );
}

function taskStateBadge(state: string): string {
  switch (state) {
    case 'success': return 'b-green';
    case 'failed': return 'b-red';
    case 'running': return 'b-amber';
    default: return 'b-gray';
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
