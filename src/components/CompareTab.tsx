import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { wsGet } from '../api/workspace';
import { listSubmissions, getSubmission } from '../api/gowe';
import { parseOutputs, type StructureFile } from '../api/outputs';
import { parseStructure, type ParsedPdb } from '../utils/pdbParser';
import WorkspaceBrowser from './WorkspaceBrowser';

/**
 * CompareTab — compare two protein structures from any source:
 *
 *  1. **This job** — structure files from the current job's outputs
 *  2. **Other job** — pick a completed job, then pick its structure file
 *  3. **Workspace** — browse workspace for any .pdb/.cif file
 *
 * Features:
 *  - Multi-source model selectors (A and B)
 *  - Client-side Cα per-residue distance + RMSD
 *  - Divergent region identification
 *  - 3Dmol.js superposition viewer
 *  - pLDDT overlay chart
 *  - Per-residue divergence chart
 */

interface Props {
  /** Structure files from the current job. */
  structureFiles: StructureFile[];
  /** Current job ID (used to exclude from cross-job list). */
  currentJobId?: string;
}

// ── Model source types ──────────────────────────────────────

type SourceType = 'job' | 'other-job' | 'workspace';

interface ModelSelection {
  source: SourceType;
  /** Display label for the selection. */
  label: string;
  /** Workspace path to the structure file. */
  wsPath: string;
  /** PDB or CIF format. */
  format: 'pdb' | 'cif';
}

// ── Client-side Cα alignment ────────────────────────────────

interface ComparisonResult {
  perResidueDistance: number[];
  rmsd: number;
  nDivergent: number;
  divergentRegions: { start: number; end: number; meanDist: number; maxDist: number }[];
  nAligned: number;
}

function compareStructures(pdb1: ParsedPdb, pdb2: ParsedPdb, threshold = 3.0): ComparisonResult {
  const n = Math.min(pdb1.nResidues, pdb2.nResidues);
  const perResidueDistance: number[] = [];
  let sumSq = 0;
  let nDivergent = 0;

  for (let i = 0; i < n; i++) {
    const c1 = pdb1.caCoords[i]!;
    const c2 = pdb2.caCoords[i]!;
    const dx = c1[0] - c2[0];
    const dy = c1[1] - c2[1];
    const dz = c1[2] - c2[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    perResidueDistance.push(d);
    sumSq += d * d;
    if (d > threshold) nDivergent++;
  }

  const rmsd = n > 0 ? Math.sqrt(sumSq / n) : 0;

  const divergentRegions: { start: number; end: number; meanDist: number; maxDist: number }[] = [];
  let regionStart = -1;
  for (let i = 0; i <= n; i++) {
    const d = i < n ? (perResidueDistance[i] ?? 0) : 0;
    if (d > threshold) {
      if (regionStart === -1) regionStart = i;
    } else {
      if (regionStart !== -1 && i - regionStart >= 3) {
        let sum = 0, max = 0;
        for (let j = regionStart; j < i; j++) {
          const v = perResidueDistance[j] ?? 0;
          sum += v;
          if (v > max) max = v;
        }
        divergentRegions.push({
          start: regionStart,
          end: i - 1,
          meanDist: sum / (i - regionStart),
          maxDist: max,
        });
      }
      regionStart = -1;
    }
  }

  return { perResidueDistance, rmsd, nDivergent, divergentRegions, nAligned: n };
}

// ── Divergence Chart (Canvas) ────────────────────────────────

function DivergenceChart({ distances, plddt1, plddt2, threshold = 3.0 }: {
  distances: number[];
  plddt1?: number[];
  plddt2?: number[];
  threshold?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const height = 180;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    obs.observe(el);
    setWidth(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || distances.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const n = distances.length;
    const marginL = 40, marginR = 10, marginT = 10, marginB = 24;
    const plotW = width - marginL - marginR;
    const plotH = height - marginT - marginB;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    let maxD = 0;
    for (const d of distances) if (d > maxD) maxD = d;
    maxD = Math.max(maxD * 1.1, threshold * 1.5);

    // Threshold line
    const threshY = marginT + plotH * (1 - threshold / maxD);
    ctx.strokeStyle = '#EF444466';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginL, threshY);
    ctx.lineTo(marginL + plotW, threshY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Shade divergent regions
    ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
    for (let i = 0; i < n; i++) {
      if ((distances[i] ?? 0) > threshold) {
        const x = marginL + (i / n) * plotW;
        const w = Math.max(plotW / n, 1);
        ctx.fillRect(x, marginT, w, plotH);
      }
    }

    // Distance line
    ctx.strokeStyle = '#1E40AF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = marginL + (i / n) * plotW;
      const y = marginT + plotH * (1 - (distances[i] ?? 0) / maxD);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // pLDDT overlays
    const drawPlddt = (vals: number[], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      for (let i = 0; i < Math.min(vals.length, n); i++) {
        const x = marginL + (i / n) * plotW;
        const y = marginT + plotH * (1 - (vals[i] ?? 0) / 100);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    if (plddt1) drawPlddt(plddt1, '#10B981');
    if (plddt2) drawPlddt(plddt2, '#F59E0B');

    // Y axis labels
    ctx.fillStyle = '#64748B';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (const v of [0, threshold, Math.round(maxD)]) {
      const y = marginT + plotH * (1 - v / maxD);
      ctx.fillText(`${v}`, marginL - 4, y + 3);
    }

    // X axis labels
    ctx.textAlign = 'center';
    const tickInterval = n <= 100 ? 10 : n <= 500 ? 50 : 100;
    for (let i = 0; i < n; i += tickInterval) {
      const x = marginL + (i / n) * plotW;
      ctx.fillText(String(i + 1), x, height - 4);
    }

    // Axis titles
    ctx.fillStyle = '#334155';
    ctx.font = '10px system-ui, sans-serif';
    ctx.save();
    ctx.translate(10, marginT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Distance (\u00C5)', 0, 0);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.fillText('Residue', marginL + plotW / 2, height - 14);
  }, [distances, plddt1, plddt2, threshold, width]);

  return (
    <div ref={containerRef}>
      <canvas ref={canvasRef} style={{ borderRadius: 6, border: '1px solid #E2E8F0', display: 'block', width: '100%' }} />
      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, color: '#94A3B8' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 12, height: 2, background: '#1E40AF', display: 'inline-block' }} /> C&alpha; distance
        </span>
        {plddt1 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 12, height: 2, background: '#10B981', opacity: 0.5, display: 'inline-block' }} /> pLDDT model A
          </span>
        )}
        {plddt2 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 12, height: 2, background: '#F59E0B', opacity: 0.5, display: 'inline-block' }} /> pLDDT model B
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 12, height: 2, background: '#EF4444', opacity: 0.4, display: 'inline-block', borderTop: '1px dashed #EF4444' }} /> {threshold} &Aring; threshold
        </span>
      </div>
    </div>
  );
}

// ── pLDDT overlay chart ──────────────────────────────────────

function PlddtOverlayChart({ plddt1, plddt2, label1, label2 }: {
  plddt1: number[];
  plddt2: number[];
  label1: string;
  label2: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const height = 140;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    obs.observe(el);
    setWidth(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const n = Math.max(plddt1.length, plddt2.length);
    if (n === 0) return;

    const marginL = 40, marginR = 10, marginT = 10, marginB = 24;
    const plotW = width - marginL - marginR;
    const plotH = height - marginT - marginB;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    const bands = [
      { min: 90, max: 100, color: 'rgba(16, 185, 129, 0.06)' },
      { min: 70, max: 90, color: 'rgba(59, 130, 246, 0.06)' },
      { min: 50, max: 70, color: 'rgba(245, 158, 11, 0.06)' },
      { min: 0, max: 50, color: 'rgba(239, 68, 68, 0.06)' },
    ];
    for (const b of bands) {
      const y0 = marginT + plotH * (1 - b.max / 100);
      const y1 = marginT + plotH * (1 - b.min / 100);
      ctx.fillStyle = b.color;
      ctx.fillRect(marginL, y0, plotW, y1 - y0);
    }

    const drawLine = (vals: number[], color: string, lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let i = 0; i < vals.length; i++) {
        const x = marginL + (i / n) * plotW;
        const y = marginT + plotH * (1 - (vals[i] ?? 0) / 100);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawLine(plddt1, '#10B981', 1.5);
    drawLine(plddt2, '#F59E0B', 1.5);

    ctx.fillStyle = '#64748B';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (const v of [0, 50, 70, 90, 100]) {
      const y = marginT + plotH * (1 - v / 100);
      ctx.fillText(String(v), marginL - 4, y + 3);
    }

    ctx.textAlign = 'center';
    const tickInterval = n <= 100 ? 10 : n <= 500 ? 50 : 100;
    for (let i = 0; i < n; i += tickInterval) {
      const x = marginL + (i / n) * plotW;
      ctx.fillText(String(i + 1), x, height - 4);
    }
  }, [plddt1, plddt2, width]);

  return (
    <div ref={containerRef}>
      <canvas ref={canvasRef} style={{ borderRadius: 6, border: '1px solid #E2E8F0', display: 'block', width: '100%' }} />
      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, color: '#94A3B8' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 12, height: 2, background: '#10B981', display: 'inline-block' }} /> {label1}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 12, height: 2, background: '#F59E0B', display: 'inline-block' }} /> {label2}
        </span>
      </div>
    </div>
  );
}

// ── ModelSourceSelector ─────────────────────────────────────

function ModelSourceSelector({ side, color, structureFiles, currentJobId, selection, onSelect }: {
  side: 'A' | 'B';
  color: string;
  structureFiles: StructureFile[];
  currentJobId?: string;
  selection: ModelSelection | null;
  onSelect: (sel: ModelSelection) => void;
}) {
  const [sourceTab, setSourceTab] = useState<SourceType>(structureFiles.length > 0 ? 'job' : 'workspace');
  const [wsBrowseOpen, setWsBrowseOpen] = useState(false);

  // --- This Job source ---
  const sorted = useMemo(() => {
    return [...structureFiles].sort((a, b) => {
      const aNum = a.name.match(/model_(\d+)/)?.[1];
      const bNum = b.name.match(/model_(\d+)/)?.[1];
      if (aNum && bNum) return parseInt(aNum, 10) - parseInt(bNum, 10);
      if (aNum) return -1;
      if (bNum) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [structureFiles]);

  // --- Other Job source ---
  const [otherJobSearch, setOtherJobSearch] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Fetch succeeded/completed jobs only
  const { data: completedJobs, isLoading: jobsLoading } = useQuery({
    queryKey: ['compare-jobs'],
    queryFn: async () => {
      const res = await listSubmissions({ limit: 100 });
      // Only show succeeded/completed jobs, exclude current job
      return res.data.filter((s) => {
        const st = s.state.toLowerCase();
        return (st === 'success' || st === 'completed') && s.id !== currentJobId;
      });
    },
    enabled: sourceTab === 'other-job',
    staleTime: 30_000,
  });

  // Filter jobs by search text
  const filteredJobs = useMemo(() => {
    if (!completedJobs) return [];
    if (!otherJobSearch) return completedJobs;
    const q = otherJobSearch.toLowerCase();
    return completedJobs.filter((s) =>
      s.id.toLowerCase().includes(q) ||
      (s.labels?.run_name ?? '').toLowerCase().includes(q) ||
      s.workflow_name.toLowerCase().includes(q)
    );
  }, [completedJobs, otherJobSearch]);

  // Fetch selected other job's outputs to find structure files
  const { data: otherJobStructures } = useQuery({
    queryKey: ['compare-job-structures', selectedJobId],
    queryFn: async () => {
      if (!selectedJobId) return [];
      const sub = await getSubmission(selectedJobId);
      if (!sub.outputs) return [];
      const parsed = parseOutputs(sub.outputs);
      return parsed.structureFiles;
    },
    enabled: !!selectedJobId,
    staleTime: Infinity,
  });

  const handleJobFileSelect = useCallback((sf: StructureFile) => {
    const jobLabel = filteredJobs.find((j) => j.id === selectedJobId);
    const jobName = jobLabel?.labels?.run_name ?? selectedJobId?.slice(0, 8) ?? '';
    onSelect({
      source: 'other-job',
      label: `${jobName} / ${sf.name}`,
      wsPath: sf.wsPath,
      format: sf.format,
    });
  }, [selectedJobId, filteredJobs, onSelect]);

  // --- Workspace browse handler ---
  const handleWsSelect = useCallback((path: string) => {
    const name = path.split('/').pop() ?? path;
    const ext = name.toLowerCase().split('.').pop();
    const format: 'pdb' | 'cif' = ext === 'cif' ? 'cif' : 'pdb';
    onSelect({
      source: 'workspace',
      label: name,
      wsPath: path,
      format,
    });
    setWsBrowseOpen(false);
  }, [onSelect]);

  const sourceTabs: { id: SourceType; label: string; icon: string }[] = [
    { id: 'job', label: 'This Job', icon: '\uD83D\uDCCB' },
    { id: 'other-job', label: 'Other Job', icon: '\uD83D\uDD17' },
    { id: 'workspace', label: 'Workspace', icon: '\uD83D\uDCC2' },
  ];

  return (
    <div className="card" style={{ padding: 16, borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>Model {side}</span>
        {selection && (
          <span style={{ fontSize: 11, color: '#64748B', fontFamily: 'monospace' }}>
            {selection.label}
          </span>
        )}
      </div>

      {/* Source tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {sourceTabs.map((t) => (
          <button
            key={t.id}
            className={`pill-sm${sourceTab === t.id ? ' active' : ''}`}
            onClick={() => setSourceTab(t.id)}
            style={{ fontSize: 11 }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* This Job */}
      {sourceTab === 'job' && (
        <div>
          {sorted.length === 0 ? (
            <div style={{ fontSize: 12, color: '#94A3B8', padding: '8px 0' }}>
              No structure files in this job&apos;s outputs.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }}>
              {sorted.map((sf) => (
                <button
                  key={sf.wsPath}
                  onClick={() => onSelect({ source: 'job', label: sf.name, wsPath: sf.wsPath, format: sf.format })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 6,
                    border: selection?.wsPath === sf.wsPath ? `2px solid ${color}` : '1px solid #E2E8F0',
                    background: selection?.wsPath === sf.wsPath ? `${color}10` : '#fff',
                    cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%',
                  }}
                >
                  <span style={{ fontWeight: 600, color: '#334155' }}>{sf.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94A3B8' }}>{sf.format.toUpperCase()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Other Job */}
      {sourceTab === 'other-job' && (
        <div>
          {!selectedJobId ? (
            <div>
              <input
                className="field-input"
                style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
                placeholder="Search jobs by name or ID..."
                value={otherJobSearch}
                onChange={(e) => setOtherJobSearch(e.target.value)}
              />
              {jobsLoading && <div style={{ fontSize: 12, color: '#94A3B8', padding: 8 }}>Loading jobs...</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflow: 'auto' }}>
                {filteredJobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 6,
                      border: '1px solid #E2E8F0', background: '#fff',
                      cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#334155' }}>
                      {job.labels?.run_name ?? job.id.slice(0, 12)}
                    </span>
                    <span style={{ fontSize: 10, color: '#94A3B8' }}>{job.workflow_name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94A3B8' }}>
                      {new Date(job.created_at).toLocaleDateString()}
                    </span>
                  </button>
                ))}
                {!jobsLoading && filteredJobs.length === 0 && (
                  <div style={{ fontSize: 12, color: '#94A3B8', padding: 8 }}>
                    {otherJobSearch ? 'No matching jobs found.' : 'No completed jobs found.'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button
                  onClick={() => setSelectedJobId(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3B82F6', fontSize: 12 }}
                >
                  &larr; Back to jobs
                </button>
                <span style={{ fontSize: 11, color: '#64748B' }}>
                  {completedJobs?.find((j) => j.id === selectedJobId)?.labels?.run_name ?? selectedJobId.slice(0, 12)}
                </span>
              </div>
              {!otherJobStructures ? (
                <div style={{ fontSize: 12, color: '#94A3B8', padding: 8 }}>Loading structure files...</div>
              ) : otherJobStructures.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94A3B8', padding: 8 }}>No structure files found in this job.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }}>
                  {otherJobStructures.map((sf) => (
                    <button
                      key={sf.wsPath}
                      onClick={() => handleJobFileSelect(sf)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', borderRadius: 6,
                        border: selection?.wsPath === sf.wsPath ? `2px solid ${color}` : '1px solid #E2E8F0',
                        background: selection?.wsPath === sf.wsPath ? `${color}10` : '#fff',
                        cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: '#334155' }}>{sf.name}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94A3B8' }}>{sf.format.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Workspace browse */}
      {sourceTab === 'workspace' && (
        <div>
          <button
            className="btn-outline"
            style={{ fontSize: 12 }}
            onClick={() => setWsBrowseOpen(true)}
          >
            Browse Workspace for .pdb / .cif
          </button>
          {selection?.source === 'workspace' && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#64748B', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {selection.wsPath}
            </div>
          )}
          <WorkspaceBrowser
            open={wsBrowseOpen}
            mode="file"
            onSelect={handleWsSelect}
            onClose={() => setWsBrowseOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── Main CompareTab ──────────────────────────────────────────

export default function CompareTab({ structureFiles, currentJobId }: Props) {
  // Default selections: first two structure files from this job, if available
  const defaultA: ModelSelection | null = useMemo(() => {
    const first = structureFiles[0];
    if (!first) return null;
    return { source: 'job', label: first.name, wsPath: first.wsPath, format: first.format };
  }, [structureFiles]);

  const defaultB: ModelSelection | null = useMemo(() => {
    const second = structureFiles[1];
    if (!second) return null;
    return { source: 'job', label: second.name, wsPath: second.wsPath, format: second.format };
  }, [structureFiles]);

  const [selA, setSelA] = useState<ModelSelection | null>(defaultA);
  const [selB, setSelB] = useState<ModelSelection | null>(defaultB);

  // Fetch structure file contents
  const { data: textA } = useQuery({
    queryKey: ['ws-compare', selA?.wsPath],
    queryFn: async () => {
      if (!selA) return null;
      const result = await wsGet([selA.wsPath]);
      return result[0]?.[1] as string | null;
    },
    enabled: !!selA,
    staleTime: Infinity,
  });

  const { data: textB } = useQuery({
    queryKey: ['ws-compare', selB?.wsPath],
    queryFn: async () => {
      if (!selB) return null;
      const result = await wsGet([selB.wsPath]);
      return result[0]?.[1] as string | null;
    },
    enabled: !!selB,
    staleTime: Infinity,
  });

  // Parse structures (format-aware: PDB or CIF)
  const pdbA = useMemo(() => textA ? parseStructure(textA, selA?.format) : null, [textA, selA?.format]);
  const pdbB = useMemo(() => textB ? parseStructure(textB, selB?.format) : null, [textB, selB?.format]);

  // Compare
  const comparison = useMemo(() => {
    if (!pdbA || !pdbB) return null;
    return compareStructures(pdbA, pdbB);
  }, [pdbA, pdbB]);

  // Mean pLDDT
  const meanPlddtA = useMemo(() => {
    if (!pdbA || pdbA.bFactors.length === 0) return null;
    let sum = 0;
    for (const b of pdbA.bFactors) sum += b;
    return sum / pdbA.bFactors.length;
  }, [pdbA]);

  const meanPlddtB = useMemo(() => {
    if (!pdbB || pdbB.bFactors.length === 0) return null;
    let sum = 0;
    for (const b of pdbB.bFactors) sum += b;
    return sum / pdbB.bFactors.length;
  }, [pdbB]);

  // 3Dmol superposition viewer
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewerRef.current || !textA || !textB) return;

    const $3Dmol = (window as unknown as Record<string, unknown>).$3Dmol as {
      createViewer: (el: HTMLElement, opts: Record<string, unknown>) => unknown;
    } | undefined;
    if (!$3Dmol) return;

    viewerRef.current.innerHTML = '';

    const viewer = $3Dmol.createViewer(viewerRef.current, {
      backgroundColor: '#f8fafc',
    }) as {
      addModel: (data: string, format: string) => { setStyle: (sel: Record<string, unknown>, style: Record<string, unknown>) => void };
      zoomTo: () => void;
      render: () => void;
      resize: () => void;
      removeAllModels: () => void;
    };

    const fmtA = selA?.format === 'cif' ? 'mmcif' : (selA?.format ?? 'pdb');
    const modelA = viewer.addModel(textA, fmtA);
    modelA.setStyle({}, { cartoon: { color: '#10B981', opacity: 0.85 } });

    const fmtB = selB?.format === 'cif' ? 'mmcif' : (selB?.format ?? 'pdb');
    const modelB = viewer.addModel(textB, fmtB);
    modelB.setStyle({}, { cartoon: { color: '#F59E0B', opacity: 0.85 } });

    viewer.zoomTo();
    viewer.render();

    return () => {
      viewer.removeAllModels();
    };
  }, [textA, textB, selA?.format, selB?.format]);

  const bothSelected = selA && selB;
  const bothLoaded = textA && textB;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Model selectors side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <ModelSourceSelector
          side="A"
          color="#10B981"
          structureFiles={structureFiles}
          currentJobId={currentJobId}
          selection={selA}
          onSelect={setSelA}
        />
        <ModelSourceSelector
          side="B"
          color="#F59E0B"
          structureFiles={structureFiles}
          currentJobId={currentJobId}
          selection={selB}
          onSelect={setSelB}
        />
      </div>

      {/* Quick metrics bar */}
      {comparison && (
        <div className="card" style={{ padding: '12px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 3, background: '#10B981', borderRadius: 1, display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>{selA?.label}</span>
            </div>
            <span style={{ fontSize: 14, color: '#94A3B8' }}>vs</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 3, background: '#F59E0B', borderRadius: 1, display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>{selB?.label}</span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 20 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>RMSD</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: comparison.rmsd < 1 ? '#10B981' : comparison.rmsd < 3 ? '#F59E0B' : '#EF4444' }}>
                  {comparison.rmsd.toFixed(2)} &Aring;
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Divergent</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#334155' }}>
                  {comparison.nDivergent}
                  <span style={{ fontSize: 11, fontWeight: 400, color: '#94A3B8' }}> / {comparison.nAligned}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Regions</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#334155' }}>
                  {comparison.divergentRegions.length}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prompt to select both models */}
      {!bothSelected && (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>{'\u2194\uFE0F'}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>Select two structures to compare</div>
          <div style={{ fontSize: 12 }}>
            Choose models from this job, another completed job, or browse your workspace for any .pdb / .cif file.
          </div>
        </div>
      )}

      {/* Loading */}
      {bothSelected && !bothLoaded && (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
          Loading structures from workspace...
        </div>
      )}

      {/* Superposition viewer + metrics */}
      {bothLoaded && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* 3D superposition */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#334155' }}>
              Superposition
            </h3>
            <div
              ref={viewerRef}
              style={{
                width: '100%',
                height: 350,
                position: 'relative',
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid #E2E8F0',
                background: '#f8fafc',
              }}
            />
            <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 10, color: '#94A3B8' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 12, height: 3, background: '#10B981', borderRadius: 1, display: 'inline-block' }} /> {selA?.label}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 12, height: 3, background: '#F59E0B', borderRadius: 1, display: 'inline-block' }} /> {selB?.label}
              </span>
            </div>
          </div>

          {/* Summary metrics */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#334155' }}>
              Comparison Summary
            </h3>

            {comparison && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <MetricBox label="C&alpha; RMSD" value={`${comparison.rmsd.toFixed(2)} \u00C5`}
                    color={comparison.rmsd < 1 ? '#10B981' : comparison.rmsd < 3 ? '#F59E0B' : '#EF4444'} />
                  <MetricBox label="Aligned Residues" value={String(comparison.nAligned)} />
                  <MetricBox label="Divergent Residues" value={`${comparison.nDivergent} (${comparison.nAligned > 0 ? ((comparison.nDivergent / comparison.nAligned) * 100).toFixed(1) : 0}%)`}
                    color={comparison.nDivergent === 0 ? '#10B981' : '#EF4444'} />
                  <MetricBox label="Divergent Regions" value={String(comparison.divergentRegions.length)} />
                </div>

                {/* pLDDT: combined A/B + ratio */}
                {meanPlddtA != null && meanPlddtB != null && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 4 }}>Mean pLDDT (A / B)</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>
                        <span style={{ color: '#10B981' }}>{meanPlddtA.toFixed(1)}</span>
                        <span style={{ color: '#94A3B8', fontWeight: 400 }}> / </span>
                        <span style={{ color: '#F59E0B' }}>{meanPlddtB.toFixed(1)}</span>
                      </div>
                    </div>
                    <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 4 }}>pLDDT Ratio (A : B)</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#334155' }}>
                        {meanPlddtB > meanPlddtA
                          ? `1 : ${(meanPlddtB / meanPlddtA).toFixed(2)}`
                          : meanPlddtA > meanPlddtB
                            ? `${(meanPlddtA / meanPlddtB).toFixed(2)} : 1`
                            : '1 : 1'}
                      </div>
                    </div>
                  </div>
                )}

                {comparison.divergentRegions.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>Divergent Regions (&gt; 3 &Aring;)</div>
                    <table className="data-table" style={{ fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th>Region</th>
                          <th>Residues</th>
                          <th style={{ textAlign: 'right' }}>Mean &Aring;</th>
                          <th style={{ textAlign: 'right' }}>Max &Aring;</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.divergentRegions.map((r, i) => (
                          <tr key={i}>
                            <td>{i + 1}</td>
                            <td>{r.start + 1}&ndash;{r.end + 1} ({r.end - r.start + 1} res)</td>
                            <td style={{ textAlign: 'right' }}>{r.meanDist.toFixed(1)}</td>
                            <td style={{ textAlign: 'right' }}>{r.maxDist.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {comparison.divergentRegions.length === 0 && (
                  <div style={{ fontSize: 12, color: '#10B981', fontWeight: 500 }}>
                    No divergent regions detected — models are structurally consistent.
                  </div>
                )}
              </div>
            )}

            {!comparison && (
              <div style={{ color: '#94A3B8', fontSize: 13 }}>Computing comparison...</div>
            )}
          </div>
        </div>
      )}

      {/* Per-residue divergence chart */}
      {comparison && (
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#334155' }}>
            Per-Residue C&alpha; Distance
          </h3>
          <DivergenceChart
            distances={comparison.perResidueDistance}
            plddt1={pdbA?.bFactors}
            plddt2={pdbB?.bFactors}
          />
        </div>
      )}

      {/* pLDDT overlay */}
      {pdbA && pdbB && pdbA.bFactors.length > 0 && pdbB.bFactors.length > 0 && (
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#334155' }}>
            pLDDT Comparison
          </h3>
          <PlddtOverlayChart
            plddt1={pdbA.bFactors}
            plddt2={pdbB.bFactors}
            label1={selA?.label ?? 'Model A'}
            label2={selB?.label ?? 'Model B'}
          />
        </div>
      )}
    </div>
  );
}

// ── MetricBox ────────────────────────────────────────────────

function MetricBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? '#334155' }} dangerouslySetInnerHTML={{ __html: value }} />
    </div>
  );
}
