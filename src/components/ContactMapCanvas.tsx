import { useRef, useEffect, useState, useMemo, useCallback } from 'react';

/**
 * Interactive contact map visualization.
 *
 * Two data modes:
 *  1. Pre-computed contact data from analysis.json (contacts_per_residue, n_contacts, etc.)
 *  2. Client-side computation from C-alpha coordinates extracted from PDB
 *
 * Features:
 *  - Binary contact view (8 A cutoff) or distance heatmap
 *  - Hover tooltip showing residue pair + distance
 *  - SS regions colored on axes (if provided)
 *  - Contact range statistics sidebar
 */

interface Props {
  /** C-alpha coordinates — array of [x, y, z] triples. */
  caCoords?: [number, number, number][];
  /** Pre-computed distance matrix (optional — computed from caCoords if absent). */
  distanceMatrix?: number[][];
  /** Contact distance cutoff in Angstroms. */
  cutoff?: number;
  /** Minimum sequence separation for contacts. */
  minSeqSep?: number;
  /** Secondary structure string (H/E/C per residue). */
  ssSequence?: string;
  /** Canvas size in CSS pixels. */
  size?: number;
  /** Display mode: binary contact map or distance heatmap. */
  mode?: 'contacts' | 'distance';
}

// ── Distance colors ──────────────────────────────────────────

function distanceColor(dist: number, cutoff: number): [number, number, number] {
  if (dist > cutoff * 2) return [240, 240, 240]; // far apart — near-white
  if (dist <= cutoff) {
    // Contact: dark blue (in contact) -> light blue (near cutoff)
    const t = dist / cutoff;
    return [
      Math.round(10 + t * 130),
      Math.round(40 + t * 130),
      Math.round(180 - t * 30),
    ];
  }
  // Beyond cutoff: light grey gradient
  const t = Math.min((dist - cutoff) / cutoff, 1);
  return [
    Math.round(140 + t * 100),
    Math.round(170 + t * 70),
    Math.round(150 + t * 90),
  ];
}

// ── Compute distance matrix from coordinates ─────────────────

function computeDistanceMatrix(coords: [number, number, number][]): number[][] {
  const n = coords.length;
  const dm: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    dm[i] = new Array(n);
    const ci = coords[i]!;
    for (let j = 0; j < n; j++) {
      if (i === j) {
        dm[i]![j] = 0;
        continue;
      }
      const cj = coords[j]!;
      const dx = ci[0] - cj[0];
      const dy = ci[1] - cj[1];
      const dz = ci[2] - cj[2];
      dm[i]![j] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  return dm;
}

// ── Contact statistics ───────────────────────────────────────

interface ContactStats {
  total: number;
  density: number;
  shortRange: number;   // sep < 6
  mediumRange: number;  // sep 6-12
  longRange: number;    // sep 12-24
  veryLongRange: number; // sep > 24
}

function computeStats(dm: number[][], cutoff: number, minSeqSep: number): ContactStats {
  const n = dm.length;
  let total = 0, shortRange = 0, mediumRange = 0, longRange = 0, veryLongRange = 0;
  let possiblePairs = 0;

  for (let i = 0; i < n; i++) {
    const row = dm[i]!;
    for (let j = i + minSeqSep; j < n; j++) {
      possiblePairs++;
      const d = row[j]!;
      if (d <= cutoff) {
        total++;
        const sep = j - i;
        if (sep < 6) shortRange++;
        else if (sep < 12) mediumRange++;
        else if (sep < 24) longRange++;
        else veryLongRange++;
      }
    }
  }

  return {
    total,
    density: possiblePairs > 0 ? total / possiblePairs : 0,
    shortRange,
    mediumRange,
    longRange,
    veryLongRange,
  };
}

// ── SS axis colors ───────────────────────────────────────────

const SS_COLORS: Record<string, string> = {
  H: '#EF4444',
  E: '#3B82F6',
  C: '#D1D5DB',
};

export default function ContactMapCanvas({
  caCoords,
  distanceMatrix: precomputedDM,
  cutoff = 8.0,
  minSeqSep = 4,
  ssSequence,
  size = 500,
  mode: initialMode = 'contacts',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; i: number; j: number; dist: number } | null>(null);
  const [mode, setMode] = useState(initialMode);

  // Compute or use pre-computed distance matrix
  const dm = useMemo(() => {
    if (precomputedDM) return precomputedDM;
    if (caCoords && caCoords.length > 0) return computeDistanceMatrix(caCoords);
    return null;
  }, [caCoords, precomputedDM]);

  const n = dm?.length ?? 0;

  // Contact statistics
  const stats = useMemo(() => {
    if (!dm) return null;
    return computeStats(dm, cutoff, minSeqSep);
  }, [dm, cutoff, minSeqSep]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dm || n === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const margin = ssSequence ? 48 : 40; // extra room for SS strip
    const ssStrip = ssSequence ? 6 : 0;
    const plotSize = size - margin;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);

    // Draw heatmap using ImageData for performance
    const imgW = Math.ceil(plotSize * dpr);
    const imgH = imgW;
    const imgData = ctx.createImageData(imgW, imgH);
    const pixels = imgData.data;

    for (let py = 0; py < imgH; py++) {
      const row = Math.floor((py / imgH) * n);
      if (row >= n) continue;
      const dmRow = dm[row]!;
      for (let px = 0; px < imgW; px++) {
        const col = Math.floor((px / imgW) * n);
        if (col >= n) continue;
        const d = dmRow[col]!;
        const idx = (py * imgW + px) * 4;

        if (mode === 'contacts') {
          const sep = Math.abs(row - col);
          if (sep < minSeqSep) {
            pixels[idx] = 245; pixels[idx + 1] = 245; pixels[idx + 2] = 245;
          } else if (d <= cutoff) {
            // Contact — dark navy
            pixels[idx] = 30; pixels[idx + 1] = 64; pixels[idx + 2] = 175;
          } else {
            pixels[idx] = 245; pixels[idx + 1] = 245; pixels[idx + 2] = 245;
          }
        } else {
          const [r, g, b] = distanceColor(d, cutoff);
          pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b;
        }
        pixels[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, (margin - ssStrip) * dpr, ssStrip * dpr);

    // Draw SS strip on left and top axes
    if (ssSequence) {
      const cellSize = plotSize / n;
      for (let i = 0; i < Math.min(n, ssSequence.length); i++) {
        const ss = ssSequence[i] ?? 'C';
        ctx.fillStyle = SS_COLORS[ss] ?? SS_COLORS.C!;
        // Top strip
        ctx.fillRect(margin - ssStrip + i * cellSize, 0, Math.max(cellSize, 1), ssStrip);
        // Left strip
        ctx.fillRect(margin - ssStrip - ssStrip, ssStrip + i * cellSize, ssStrip, Math.max(cellSize, 1));
      }
    }

    // Axis labels
    ctx.fillStyle = '#64748B';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';

    const tickInterval = n <= 100 ? 10 : n <= 500 ? 50 : 100;
    const axisOffset = margin - ssStrip;

    for (let i = 0; i < n; i += tickInterval) {
      const pos = axisOffset + (i / n) * plotSize;
      ctx.fillText(String(i + 1), pos, size - 2);

      ctx.save();
      ctx.textAlign = 'right';
      ctx.fillText(String(i + 1), axisOffset - ssStrip - 2, ssStrip + (i / n) * plotSize + 4);
      ctx.restore();
    }

    // Axis titles
    ctx.fillStyle = '#334155';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Residue index', axisOffset + plotSize / 2, size - 16);

    ctx.save();
    ctx.translate(10, ssStrip + plotSize / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Residue index', 0, 0);
    ctx.restore();
  }, [dm, n, mode, cutoff, minSeqSep, ssSequence, size]);

  // Mouse interaction
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !dm) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const ssStrip = ssSequence ? 6 : 0;
    const margin = ssSequence ? 48 : 40;
    const axisOffset = margin - ssStrip;
    const plotSize = size - margin;

    const col = Math.floor(((mx - axisOffset) / plotSize) * n);
    const row = Math.floor(((my - ssStrip) / plotSize) * n);

    if (row >= 0 && row < n && col >= 0 && col < n && mx >= axisOffset && my >= ssStrip) {
      const d = dm[row]?.[col] ?? 0;
      setTooltip({ x: mx, y: my, i: row, j: col, dist: d });
    } else {
      setTooltip(null);
    }
  }, [dm, n, ssSequence, size]);

  if (!dm || n === 0) {
    return (
      <div style={{ padding: 24, color: '#94A3B8', fontSize: 13, textAlign: 'center' }}>
        No coordinate data available for contact map.
      </div>
    );
  }

  return (
    <div>
      {/* Mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          className={`view-toggle-btn${mode === 'contacts' ? ' active' : ''}`}
          style={{ fontSize: 11, padding: '3px 10px' }}
          onClick={() => setMode('contacts')}
        >
          Contacts
        </button>
        <button
          type="button"
          className={`view-toggle-btn${mode === 'distance' ? ' active' : ''}`}
          style={{ fontSize: 11, padding: '3px 10px' }}
          onClick={() => setMode('distance')}
        >
          Distance
        </button>
        <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 8 }}>
          Cutoff: {cutoff} &Aring; &middot; Min sep: {minSeqSep}
        </span>
      </div>

      <div style={{ position: 'relative', display: 'inline-block' }}>
        <canvas
          ref={canvasRef}
          style={{ cursor: 'crosshair', borderRadius: 6, border: '1px solid #E2E8F0' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        />

        {tooltip && (
          <div
            style={{
              position: 'absolute',
              left: tooltip.x + 12,
              top: tooltip.y - 36,
              background: 'rgba(15,23,42,0.92)',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 11,
              fontFamily: 'monospace',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 10,
            }}
          >
            Res {tooltip.i + 1} &harr; {tooltip.j + 1}: <strong>{tooltip.dist.toFixed(1)} &Aring;</strong>
            {tooltip.dist <= cutoff && Math.abs(tooltip.i - tooltip.j) >= minSeqSep && (
              <span style={{ color: '#34D399', marginLeft: 6 }}>contact</span>
            )}
          </div>
        )}
      </div>

      {/* Statistics */}
      {stats && (
        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: '#64748B', flexWrap: 'wrap' }}>
          <span><strong style={{ color: '#334155' }}>{stats.total}</strong> contacts</span>
          <span>density {stats.density.toFixed(4)}</span>
          <span style={{ color: '#10B981' }}>short {stats.shortRange}</span>
          <span style={{ color: '#3B82F6' }}>medium {stats.mediumRange}</span>
          <span style={{ color: '#F59E0B' }}>long {stats.longRange}</span>
          <span style={{ color: '#EF4444' }}>very long {stats.veryLongRange}</span>
        </div>
      )}

      {/* SS legend */}
      {ssSequence && (
        <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 10, color: '#94A3B8' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 8, background: '#EF4444', borderRadius: 2 }} /> Helix
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 8, background: '#3B82F6', borderRadius: 2 }} /> Sheet
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 8, background: '#D1D5DB', borderRadius: 2 }} /> Coil
          </span>
        </div>
      )}
    </div>
  );
}

export { computeDistanceMatrix, computeStats, type ContactStats };
