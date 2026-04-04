import { getToken } from './auth';

const API_BASE = '/folding/api/v1';

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: token } : {};
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const isHtml = body.trimStart().startsWith('<') ||
      (res.headers.get('content-type') ?? '').includes('text/html');
    const message = isHtml
      ? `GoWe server is unreachable (HTTP ${res.status}). Please try again later.`
      : `GoWe ${res.status}: ${body}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// --- Types ---

export type SubmissionState =
  | 'pending' | 'scheduled' | 'queued' | 'running'
  | 'success' | 'completed' | 'failed' | 'cancelled';

export interface TaskSummary {
  total: number;
  pending: number;
  scheduled: number;
  queued: number;
  running: number;
  success: number;
  failed: number;
  skipped: number;
}

export interface Submission {
  id: string;
  workflow_id: string;
  workflow_name: string;
  state: SubmissionState;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  labels: Record<string, string>;
  error?: { code: string; message: string };
  task_summary: TaskSummary;
  submitted_by: string;
  created_at: string;
  completed_at?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  inputs: Array<{ name: string; type: string; doc?: string }>;
  outputs: Array<{ name: string; type: string }>;
}

export interface Task {
  id: string;
  submission_id: string;
  step_id: string;
  state: string;
  exit_code?: number;
  started_at?: string;
  completed_at?: string;
  runtime_ms?: number;
}

interface PaginatedResponse<T> {
  data: T[];
  total?: number;
  next_page_token?: string;
}

// --- Workflows ---

export async function listWorkflows(): Promise<Workflow[]> {
  const res = await apiFetch<{ data: Workflow[] }>('/workflows');
  return res.data;
}

// --- Submissions ---

export interface SubmitJobInput {
  workflow_id: string;
  inputs: Record<string, unknown>;
  /** ws:// URI for workspace destination where results will be uploaded. */
  output_destination?: string;
  labels?: Record<string, string>;
}

export async function submitJob(input: SubmitJobInput): Promise<Submission> {
  const res = await apiFetch<{ data: Submission }>('/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return res.data;
}

export interface ListSubmissionsParams {
  limit?: number;
  offset?: number;
  state?: SubmissionState;
  workflow_id?: string;
}

export async function listSubmissions(params: ListSubmissionsParams = {}): Promise<PaginatedResponse<Submission>> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  if (params.state) query.set('state', params.state);
  if (params.workflow_id) query.set('workflow_id', params.workflow_id);
  const qs = query.toString();
  const result = await apiFetch<PaginatedResponse<Submission>>(`/submissions${qs ? `?${qs}` : ''}`);
  if (!result.data) result.data = [];
  for (const s of result.data) {
    s.state = s.state.toLowerCase() as SubmissionState;
  }
  return result;
}

export async function getSubmission(id: string): Promise<Submission> {
  const res = await apiFetch<{ data: Submission }>(`/submissions/${id}`);
  res.data.state = res.data.state.toLowerCase() as SubmissionState;
  return res.data;
}

export async function cancelSubmission(id: string): Promise<void> {
  await apiFetch(`/submissions/${id}/cancel`, { method: 'PUT' });
}

// --- Tasks ---

export async function listTasks(submissionId: string): Promise<Task[]> {
  const res = await apiFetch<{ data: Task[] }>(`/submissions/${submissionId}/tasks`);
  return res.data;
}

export async function getTaskLogs(submissionId: string, taskId: string): Promise<{ stdout: string; stderr: string }> {
  return apiFetch(`/submissions/${submissionId}/tasks/${taskId}/logs`);
}

// --- Files ---

export async function uploadFile(file: File): Promise<{ id: string; url: string; path: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/files`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

export function fileDownloadUrl(path: string): string {
  return `${API_BASE}/files/download?path=${encodeURIComponent(path)}`;
}

// --- Health ---

export async function healthCheck(): Promise<boolean> {
  try {
    await apiFetch('/health');
    return true;
  } catch {
    return false;
  }
}
