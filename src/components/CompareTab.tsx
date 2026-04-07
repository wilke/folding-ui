import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { wsGet } from '../api/workspace';
import type { StructureFile } from '../api/outputs';
import { parsePdb, type ParsedPdb } from '../utils/pdbParser';

/**
 * CompareTab — compare multiple structure prediction samples.
 *
 * Features:
 *  - Model selector dropdowns (model A vs model B)
 *  - pLDDT overlay chart (both models on same axis)
 *  - Per-residue distance profile (client-side Cα RMSD)
 *  - Superposition viewer (both models in 3Dmol.js)
 *  - Divergent region summary
 */

interface Props {
  structureFiles: StructureFile[];
}

// ── Client-side Cα alignment (Kabsch-free per-residue distance) ──

interface ComparisonResult {
  /** Per-residue Cα distance in Angstroms. */
  perResidueDistance: number[];
  /** Overall RMSD (unaligned — same frame). */
  rmsd: number;
  /** Number of divergent residues (distance > 3 Å). */
  nDivergent: number;
  /** Divergent regions: contiguous stretches with distance > threshold. */
  divergentRegions: { start: number; end: number; meanDist: number; maxDist: number }[];
  /** Number of aligned residues. */
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

  // Identify divergent regions
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

    // Clear
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    // Find max distance for Y scale
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

    // pLDDT overlays (right Y axis, scaled 0-100)
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
    const yTicks = [0, threshold, Math.round(maxD)];
    for (const v of yTicks) {
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
      {/* Legend */}
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

    // Confidence bands
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

    // Draw both lines
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

    // Y axis
    ctx.fillStyle = '#64748B';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (const v of [0, 50, 70, 90, 100]) {
      const y = marginT + plotH * (1 - v / 100);
      ctx.fillText(String(v), marginL - 4, y + 3);
    }

    // X axis
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

// ── Main CompareTab ──────────────────────────────────────────

export default function CompareTab({ structureFiles }: Props) {
  // Sort structure files: model_1, model_2, ... then alphabetical
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

  const [idxA, setIdxA] = useState(0);
  const [idxB, setIdxB] = useState(Math.min(1, sorted.length - 1));

  const fileA = sorted[idxA];
  const fileB = sorted[idxB];

  // Fetch both PDB files
  const { data: textA } = useQuery({
    queryKey: ['ws-compare', fileA?.wsPath],
    queryFn: async () => {
      if (!fileA) return null;
      const result = await wsGet([fileA.wsPath]);
      return result[0]?.[1] as string | null;
    },
    enabled: !!fileA,
    staleTime: Infinity,
  });

  const { data: textB } = useQuery({
    queryKey: ['ws-compare', fileB?.wsPath],
    queryFn: async () => {
      if (!fileB) return null;
      const result = await wsGet([fileB.wsPath]);
      return result[0]?.[1] as string | null;
    },
    enabled: !!fileB,
    staleTime: Infinity,
  });

  // Parse PDBs
  const pdbA = useMemo(() => textA ? parsePdb(textA) : null, [textA]);
  const pdbB = useMemo(() => textB ? parsePdb(textB) : null, [textB]);

  // Compare
  const comparison = useMemo(() => {
    if (!pdbA || !pdbB) return null;
    return compareStructures(pdbA, pdbB);
  }, [pdbA, pdbB]);

  // Mean pLDDT for each
  const meanPlddtA = useMemo(() => {
    if (!pdbA) return null;
    let sum = 0;
    for (const b of pdbA.bFactors) sum += b;
    return sum / (pdbA.bFactors.length || 1);
  }, [pdbA]);

  const meanPlddtB = useMemo(() => {
    if (!pdbB) return null;
    let sum = 0;
    for (const b of pdbB.bFactors) sum += b;
    return sum / (pdbB.bFactors.length || 1);
  }, [pdbB]);

  // 3Dmol superposition viewer
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewerRef.current || !textA || !textB) return;

    const $3Dmol = (window as unknown as Record<string, unknown>).$3Dmol as {
      createViewer: (el: HTMLElement, opts: Record<string, unknown>) => unknown;
    } | undefined;
    if (!$3Dmol) return;

    // Clear any previous viewer canvas (3Dmol appends a canvas each time)
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

    const modelA = viewer.addModel(textA, fileA?.format ?? 'pdb');
    modelA.setStyle({}, { cartoon: { color: '#10B981', opacity: 0.85 } });

    const modelB = viewer.addModel(textB, fileB?.format ?? 'pdb');
    modelB.setStyle({}, { cartoon: { color: '#F59E0B', opacity: 0.85 } });

    viewer.zoomTo();
    viewer.render();

    return () => {
      viewer.removeAllModels();
    };
  }, [textA, textB, fileA?.format, fileB?.format]);

  if (sorted.length < 2) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
        <div style={{ fontSize: 18, marginBottom: 8 }}>Single model</div>
        <div style={{ fontSize: 13 }}>
          Comparison requires at least 2 structure files (e.g., multiple samples with <code>num_samples &gt; 1</code>).
          This job produced {sorted.length} structure file{sorted.length !== 1 ? 's' : ''}.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Model selector */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <label className="field-label" style={{ marginBottom: 4 }}>Model A</label>
            <select
              className="field-input"
              style={{ minWidth: 200, borderColor: '#10B981' }}
              value={idxA}
              onChange={(e) => setIdxA(Number(e.target.value))}
            >
              {sorted.map((f, i) => (
                <option key={f.wsPath} value={i}>{f.name}</option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 18, color: '#94A3B8', paddingTop: 20 }}>vs</div>
          <div>
            <label className="field-label" style={{ marginBottom: 4 }}>Model B</label>
            <select
              className="field-input"
              style={{ minWidth: 200, borderColor: '#F59E0B' }}
              value={idxB}
              onChange={(e) => setIdxB(Number(e.target.value))}
            >
              {sorted.map((f, i) => (
                <option key={f.wsPath} value={i}>{f.name}</option>
              ))}
            </select>
          </div>

          {/* Quick metrics */}
          {comparison && (
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
          )}
        </div>
      </div>

      {/* Loading state */}
      {(!textA || !textB) && (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
          Loading structures from workspace...
        </div>
      )}

      {/* Superposition viewer + metrics */}
      {textA && textB && (
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
                <span style={{ width: 12, height: 3, background: '#10B981', borderRadius: 1, display: 'inline-block' }} /> {fileA?.name}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 12, height: 3, background: '#F59E0B', borderRadius: 1, display: 'inline-block' }} /> {fileB?.name}
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
                {/* Metrics grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <MetricBox label="C&alpha; RMSD" value={`${comparison.rmsd.toFixed(2)} \u00C5`}
                    color={comparison.rmsd < 1 ? '#10B981' : comparison.rmsd < 3 ? '#F59E0B' : '#EF4444'} />
                  <MetricBox label="Aligned Residues" value={String(comparison.nAligned)} />
                  <MetricBox label="Divergent Residues" value={`${comparison.nDivergent} (${comparison.nAligned > 0 ? ((comparison.nDivergent / comparison.nAligned) * 100).toFixed(1) : 0}%)`}
                    color={comparison.nDivergent === 0 ? '#10B981' : '#EF4444'} />
                  <MetricBox label="Divergent Regions" value={String(comparison.divergentRegions.length)} />
                  {meanPlddtA != null && <MetricBox label={`Mean pLDDT (${fileA?.name})`} value={meanPlddtA.toFixed(1)} color="#10B981" />}
                  {meanPlddtB != null && <MetricBox label={`Mean pLDDT (${fileB?.name})`} value={meanPlddtB.toFixed(1)} color="#F59E0B" />}
                </div>

                {/* Divergent regions table */}
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
            label1={fileA?.name ?? 'Model A'}
            label2={fileB?.name ?? 'Model B'}
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
