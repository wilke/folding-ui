import { useEffect, useRef, useState, useCallback } from 'react';
import { getToken } from '../api/auth';
import type { Submission } from '../api/gowe';

const SSE_BASE = '/folding/api/v1/sse';

interface UseSSEResult {
  submission: Submission | null;
  connected: boolean;
  error: string | null;
}

/**
 * Subscribe to SSE updates for a submission.
 * Automatically reconnects on disconnect. Stops when submission reaches a terminal state.
 */
export function useSubmissionSSE(submissionId: string | undefined): UseSSEResult {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!submissionId) return;

    // EventSource doesn't support custom headers, so we pass the token as a query param.
    // The GoWe server accepts ?token= as an alternative to Authorization header.
    const token = getToken();
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    const qs = params.toString();

    const url = `${SSE_BASE}/submissions/${submissionId}${qs ? `?${qs}` : ''}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
    };

    es.addEventListener('init', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as Submission;
        setSubmission(data);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('update', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as Submission;
        setSubmission(data);
        // Close on terminal states
        if (['success', 'failed', 'cancelled'].includes(data.state)) {
          es.close();
          setConnected(false);
        }
      } catch { /* ignore parse errors */ }
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      // Reconnect after 3 seconds unless terminal
      setSubmission((prev) => {
        if (prev && ['success', 'failed', 'cancelled'].includes(prev.state)) {
          return prev;
        }
        setTimeout(connect, 3000);
        setError('Connection lost, reconnecting...');
        return prev;
      });
    };
  }, [submissionId]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
    };
  }, [connect]);

  return { submission, connected, error };
}
