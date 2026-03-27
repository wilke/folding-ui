import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listSubmissions, type SubmissionState } from '../api/gowe';
import JobStatusBadge from '../components/JobStatusBadge';

const PAGE_SIZE = 20;
const STATE_FILTERS: Array<{ value: SubmissionState | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
];

export default function JobsListPage() {
  const [offset, setOffset] = useState(0);
  const [stateFilter, setStateFilter] = useState<SubmissionState | 'all'>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['submissions', offset, stateFilter],
    queryFn: () =>
      listSubmissions({
        limit: PAGE_SIZE,
        offset,
        state: stateFilter === 'all' ? undefined : stateFilter,
      }),
    refetchInterval: 10000,
  });

  const submissions = data?.data ?? [];

  return (
    <div className="container">
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="section-title" style={{ marginBottom: 0 }}>Jobs</h2>
          </div>
          <Link to="/folding/submit" className="btn-primary btn-sm">New Job</Link>
        </div>

        {/* State filters */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid #F1F5F9' }}>
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

        {/* Table */}
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
                  <td>{sub.labels?.run_name ?? sub.workflow_name ?? '-'}</td>
                  <td>{String(sub.inputs?.tool ?? 'auto')}</td>
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

        {/* Pagination */}
        {(submissions.length === PAGE_SIZE || offset > 0) && (
          <div style={{ padding: '12px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between' }}>
            <button
              className="btn-outline btn-sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <span style={{ fontSize: 13, color: '#94A3B8' }}>
              Showing {offset + 1}–{offset + submissions.length}
            </span>
            <button
              className="btn-outline btn-sm"
              disabled={submissions.length < PAGE_SIZE}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
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
