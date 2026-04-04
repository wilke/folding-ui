import { useRef, useEffect, useMemo } from 'react';

interface PlddtChartProps {
  /** Per-residue pLDDT scores (0-100 scale) or (0-1 scale, auto-detected). */
  values: number[];
  /** Chart height in pixels. */
  height?: number;
}

/** Color for a pLDDT value (0-100 scale). */
function plddtColor(v: number): string {
  if (v >= 90) return '#10B981';  // very high — green
  if (v >= 70) return '#3B82F6';  // confident — blue
  if (v >= 50) return '#F59E0B';  // low — amber
  return '#EF4444';               // very low — red
}

/**
 * Canvas-based per-residue pLDDT profile chart.
 * No external chart library needed. Renders colored bars per residue
 * with horizontal threshold lines.
 */
export default function PlddtChart({ values, height = 180 }: PlddtChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Memoize scaled values and stats to avoid re-creating arrays and redrawing canvas every render
  const { scaled, mean, minVal, maxScaled } = useMemo(() => {
    let mx = 0;
    for (let i = 0; i < values.length; i++) {
      if ((values[i] ?? 0) > mx) mx = values[i] ?? 0;
    }
    const s = mx <= 1.0 ? 100 : 1;
    const arr = s === 100 ? values.map((v) => v * 100) : values;
    let sum = 0, mn = Infinity, mxs = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i] ?? 0;
      sum += v;
      if (v < mn) mn = v;
      if (v > mxs) mxs = v;
    }
    return { scaled: arr, mean: sum / (arr.length || 1), minVal: mn === Infinity ? 0 : mn, maxScaled: mxs === -Infinity ? 0 : mxs };
  }, [values]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const padLeft = 36;
    const padRight = 8;
    const padTop = 8;
    const padBottom = 24;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    // Background
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, w, h);

    // Y-axis labels & gridlines
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const yVal of [0, 50, 70, 90, 100]) {
      const y = padTop + plotH * (1 - yVal / 100);
      // Threshold lines at 50, 70, 90
      if (yVal > 0 && yVal < 100) {
        ctx.strokeStyle = yVal === 70 ? '#CBD5E1' : '#E2E8F0';
        ctx.lineWidth = yVal === 70 ? 1 : 0.5;
        ctx.setLineDash(yVal === 70 ? [] : [3, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(String(yVal), padLeft - 4, y);
    }

    // Bars — cap width at 20px so short sequences don't look stretched
    const n = scaled.length;
    const barW = Math.min(Math.max(plotW / n, 0.5), 20);
    for (let i = 0; i < n; i++) {
      const v = Math.min(scaled[i] ?? 0, 100);
      const barH = (v / 100) * plotH;
      const x = padLeft + (i / n) * plotW;
      const y = padTop + plotH - barH;
      ctx.fillStyle = plddtColor(v);
      ctx.fillRect(x, y, Math.max(barW - 0.5, 0.5), barH);
    }

    // X-axis label
    ctx.fillStyle = '#94A3B8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(`Residue (1–${n})`, padLeft + plotW / 2, h - 14);

    // Border
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft, padTop, plotW, plotH);
  }, [scaled, height]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height, display: 'block', borderRadius: 6 }}
      />
      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: '#64748B', flexWrap: 'wrap' }}>
        <span>Mean: <strong style={{ color: plddtColor(mean) }}>{mean.toFixed(1)}</strong></span>
        <span>Min: <strong>{minVal.toFixed(1)}</strong></span>
        <span>Max: <strong>{maxScaled.toFixed(1)}</strong></span>
        <span>{scaled.length} residues</span>
      </div>
    </div>
  );
}
