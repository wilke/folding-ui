import { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Interactive PAE (Predicted Aligned Error) heatmap.
 *
 * Renders an NxN matrix on a Canvas element with:
 *  - Blue (0 A) -> White (15 A) -> Red (31.75 A) color scale
 *  - Domain boundaries as dashed boxes
 *  - Hover tooltip showing residue pair + PAE value
 *  - Click-to-zoom into sub-regions
 */

interface Props {
  /** NxN PAE matrix (pae_matrix from analysis.json). */
  matrix: number[][];
  /** Domain assignments — list of residue index arrays, one per domain. */
  domains?: number[][];
  /** Maximum PAE value for color scale (default: 31.75). */
  maxPae?: number;
  /** Canvas size in CSS pixels (default: 500). */
  size?: number;
}

// ── Color scale ──────────────────────────────────────────────

function paeColor(value: number, maxPae: number): [number, number, number] {
  const t = Math.min(value / maxPae, 1);
  if (t <= 0.5) {
    // Blue (0,100,200) -> White (255,255,255)
    const s = t * 2; // 0..1
    return [
      Math.round(0 + s * 255),
      Math.round(100 + s * 155),
      Math.round(200 + s * 55),
    ];
  }
  // White (255,255,255) -> Red (220,50,50)
  const s = (t - 0.5) * 2; // 0..1
  return [
    Math.round(255 - s * 35),
    Math.round(255 - s * 205),
    Math.round(255 - s * 205),
  ];
}

export default function PAEHeatmap({ matrix, domains, maxPae = 31.75, size = 500 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; i: number; j: number; value: number } | null>(null);
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null);

  const n = matrix.length;
  const viewStart = zoom?.start ?? 0;
  const viewEnd = zoom?.end ?? n;
  const viewSize = viewEnd - viewStart;

  // Build domain lookup: residue index -> domain id
  const domainOf = useCallback(() => {
    const map = new Int32Array(n).fill(-1);
    if (domains) {
      for (let d = 0; d < domains.length; d++) {
        const dom = domains[d];
        if (!dom) continue;
        for (let k = 0; k < dom.length; k++) {
          const idx = dom[k];
          if (idx !== undefined && idx >= 0 && idx < n) map[idx] = d;
        }
      }
    }
    return map;
  }, [n, domains]);

  // Render heatmap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Margins for axis labels
    const margin = 40;
    const plotSize = size - margin;
    const cellSize = plotSize / viewSize;

    // Clear
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);

    // Draw heatmap cells
    const imgData = ctx.createImageData(Math.ceil(plotSize * dpr), Math.ceil(plotSize * dpr));
    const pixels = imgData.data;
    const imgW = imgData.width;

    for (let py = 0; py < imgData.height; py++) {
      const row = viewStart + Math.floor((py / imgData.height) * viewSize);
      if (row >= n) continue;
      const matRow = matrix[row];
      if (!matRow) continue;
      for (let px = 0; px < imgW; px++) {
        const col = viewStart + Math.floor((px / imgW) * viewSize);
        if (col >= n) continue;
        const val = matRow[col] ?? 0;
        const [r, g, b] = paeColor(val, maxPae);
        const idx = (py * imgW + px) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
      }
    }

    // Draw image
    ctx.putImageData(imgData, margin * dpr, 0);

    // Draw domain boundaries
    if (domains && domains.length > 1) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;

      for (const dom of domains) {
        if (!dom || dom.length === 0) continue;
        let dMin = Infinity, dMax = -Infinity;
        for (const idx of dom) {
          if (idx < viewStart || idx >= viewEnd) continue;
          if (idx < dMin) dMin = idx;
          if (idx > dMax) dMax = idx;
        }
        if (dMin === Infinity) continue;

        const x0 = margin + (dMin - viewStart) * cellSize;
        const y0 = (dMin - viewStart) * cellSize;
        const w = (dMax - dMin + 1) * cellSize;

        ctx.strokeRect(x0, y0, w, w);
      }
      ctx.restore();
    }

    // Axis labels
    ctx.fillStyle = '#64748B';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';

    const tickInterval = viewSize <= 100 ? 10 : viewSize <= 500 ? 50 : 100;
    for (let i = viewStart; i < viewEnd; i += tickInterval) {
      const pos = margin + (i - viewStart) * cellSize;
      // Bottom axis
      ctx.fillText(String(i + 1), pos, size - 2);
      // Left axis (rotated)
      ctx.save();
      ctx.translate(margin - 4, (i - viewStart) * cellSize + cellSize / 2);
      ctx.textAlign = 'right';
      ctx.fillText(String(i + 1), 0, 3);
      ctx.restore();
    }

    // Axis titles
    ctx.fillStyle = '#334155';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Scored residue', margin + plotSize / 2, size - 16);

    ctx.save();
    ctx.translate(10, plotSize / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Aligned residue', 0, 0);
    ctx.restore();
  }, [matrix, n, viewStart, viewEnd, viewSize, maxPae, size, domains]);

  // Mouse interaction
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const margin = 40;
    const plotSize = size - margin;

    if (mx < margin || my > plotSize) {
      setTooltip(null);
      return;
    }

    const col = viewStart + Math.floor(((mx - margin) / plotSize) * viewSize);
    const row = viewStart + Math.floor((my / plotSize) * viewSize);

    if (row >= 0 && row < n && col >= 0 && col < n) {
      const val = matrix[row]?.[col] ?? 0;
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, i: row, j: col, value: val });
    } else {
      setTooltip(null);
    }
  }, [matrix, n, viewStart, viewSize, size]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const margin = 40;
    const plotSize = size - margin;

    if (mx < margin || my > plotSize) return;

    // If already zoomed and clicking, check if click is on a domain
    if (domains && domains.length > 1) {
      const row = viewStart + Math.floor((my / plotSize) * viewSize);
      const dMap = domainOf();
      const d = dMap[row];

      if (d !== undefined && d >= 0 && domains[d]) {
        const dom = domains[d]!;
        let dMin = Infinity, dMax = -Infinity;
        for (const idx of dom) {
          if (idx < dMin) dMin = idx;
          if (idx > dMax) dMax = idx;
        }
        // If not already zoomed to this domain, zoom in
        if (viewStart !== dMin || viewEnd !== dMax + 1) {
          const pad = Math.max(5, Math.round((dMax - dMin) * 0.1));
          setZoom({ start: Math.max(0, dMin - pad), end: Math.min(n, dMax + 1 + pad) });
          return;
        }
      }
    }
  }, [domains, domainOf, n, viewStart, viewEnd, viewSize, size]);

  const handleReset = () => setZoom(null);

  // Color scale legend
  const legendSteps = 6;

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ cursor: 'crosshair', borderRadius: 6, border: '1px solid #E2E8F0' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        onClick={handleClick}
      />

      {/* Tooltip */}
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
          Res {tooltip.i + 1} &harr; {tooltip.j + 1}: <strong>{tooltip.value.toFixed(1)} &Aring;</strong>
        </div>
      )}

      {/* Color scale legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <span style={{ fontSize: 10, color: '#64748B' }}>0</span>
        <div style={{ display: 'flex', height: 12, borderRadius: 3, overflow: 'hidden', flex: 1, maxWidth: 200 }}>
          {Array.from({ length: legendSteps }, (_, i) => {
            const val = (i / (legendSteps - 1)) * maxPae;
            const [r, g, b] = paeColor(val, maxPae);
            return <div key={i} style={{ flex: 1, background: `rgb(${r},${g},${b})` }} />;
          })}
        </div>
        <span style={{ fontSize: 10, color: '#64748B' }}>{maxPae.toFixed(1)} &Aring;</span>

        {zoom && (
          <button
            type="button"
            onClick={handleReset}
            style={{
              marginLeft: 12, fontSize: 11, color: '#3B82F6', background: 'none', border: 'none',
              cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            Reset zoom
          </button>
        )}

        {domains && domains.length > 1 && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94A3B8' }}>
            {domains.length} domains &middot; click domain to zoom
          </span>
        )}
      </div>
    </div>
  );
}
