import type { SubmissionState } from '../api/gowe';

const STATE_STYLES: Record<SubmissionState, { className: string; label: string }> = {
  pending: { className: 'b-gray', label: 'Pending' },
  scheduled: { className: 'b-gray', label: 'Scheduled' },
  queued: { className: 'b-blue', label: 'Queued' },
  running: { className: 'b-amber', label: 'Running' },
  success: { className: 'b-green', label: 'Completed' },
  failed: { className: 'b-red', label: 'Failed' },
  cancelled: { className: 'b-gray', label: 'Cancelled' },
};

interface Props {
  state: SubmissionState;
}

export default function JobStatusBadge({ state }: Props) {
  const style = STATE_STYLES[state] ?? { className: 'b-gray', label: state };
  return <span className={`badge ${style.className}`}>{style.label}</span>;
}
