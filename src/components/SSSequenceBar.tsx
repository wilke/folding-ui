import { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Secondary structure sequence bar — colored strip showing H/E/C assignment
 * per residue with hover tooltip.
 */

interface Props {
  /** SS assignment string, one char per residue (H=helix, E=sheet, C=coil). */
  ssSequence: string;
  /** pLDDT values for confidence overlay (optional). */
  plddt?: number[];
  /** Width in CSS pixels (default: 100%). */
  width?: number;
  /** Bar height (default: 28). */
  height?: number;
}

const SS_LABELS: Record<string, string> = {
  H: 'Helix',
  E: 'Sheet',
  C: 'Coil',
};

const SS_COLORS: Record<string, string> = {
  H: '#EF4444',
  E: '#3B82F6',
  C: '#D1D5DB',
};

export default function SSSequenceBar({ ssSequence, plddt, width, height = 28 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; res: number; ss: string; conf?: number } | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(width ?? 600);

  // Auto-measure container width
  useEffect(() => {
    if (width) {
      setCanvasWidth(width);
      return;
    }
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    setCanvasWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [width]);

  const n = ssSequence.length;

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || n === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const cellW = canvasWidth / n;

    for (let i = 0; i < n; i++) {
      const ss = ssSequence[i] ?? 'C';
      ctx.fillStyle = SS_COLORS[ss] ?? SS_COLORS.C!;
      ctx.fillRect(i * cellW, 0, Math.max(cellW, 1), height);
    }

    // Draw residue number ticks
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.font = `${Math.min(9, Math.max(7, cellW * 3))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';

    const tickInterval = n <= 100 ? 10 : n <= 500 ? 50 : 100;
    for (let i = tickInterval; i < n; i += tickInterval) {
      const x = (i + 0.5) * cellW;
      ctx.fillText(String(i), x, height - 2);
    }
  }, [ssSequence, n, canvasWidth, height]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const res = Math.floor((mx / canvasWidth) * n);

    if (res >= 0 && res < n) {
      const ss = ssSequence[res] ?? 'C';
      setTooltip({
        x: mx,
        res,
        ss,
        conf: plddt?.[res],
      });
    } else {
      setTooltip(null);
    }
  }, [n, ssSequence, plddt, canvasWidth]);

  if (n === 0) return null;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ borderRadius: 4, cursor: 'crosshair', display: 'block', width: '100%' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      />

      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(tooltip.x + 10, canvasWidth - 120),
            top: -30,
            background: 'rgba(15,23,42,0.92)',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: 10,
            fontFamily: 'monospace',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          Res {tooltip.res + 1}: <strong style={{ color: SS_COLORS[tooltip.ss] }}>{SS_LABELS[tooltip.ss] ?? tooltip.ss}</strong>
          {tooltip.conf !== undefined && (
            <span style={{ marginLeft: 6, color: '#94A3B8' }}>pLDDT {tooltip.conf.toFixed(1)}</span>
          )}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 10, color: '#94A3B8' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 8, height: 8, background: SS_COLORS.H, borderRadius: 2, display: 'inline-block' }} /> Helix
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 8, height: 8, background: SS_COLORS.E, borderRadius: 2, display: 'inline-block' }} /> Sheet
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 8, height: 8, background: SS_COLORS.C, borderRadius: 2, display: 'inline-block' }} /> Coil
        </span>
        <span style={{ marginLeft: 'auto' }}>{n} residues</span>
      </div>
    </div>
  );
}
