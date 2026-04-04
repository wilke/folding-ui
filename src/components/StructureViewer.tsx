import { useEffect, useRef, useState, useCallback } from 'react';

declare global {
  interface Window {
    $3Dmol: {
      createViewer: (
        element: HTMLElement,
        config?: Record<string, unknown>,
      ) => Viewer;
    };
  }
}

interface Viewer {
  addModel(data: string, format: string): Model;
  setStyle(sel: Record<string, unknown>, style: Record<string, unknown>): void;
  zoomTo(): void;
  render(): void;
  clear(): void;
  resize(): void;
  setBackgroundColor(color: string): void;
}

interface Model {
  setStyle(sel: Record<string, unknown>, style: Record<string, unknown>): void;
}

type ColorMode = 'spectrum' | 'confidence' | 'chain' | 'secondary';
type RenderStyle = 'cartoon' | 'stick' | 'sphere';

interface StructureViewerProps {
  data: string;
  format?: 'pdb' | 'cif' | 'sdf' | 'mol2';
  showControls?: boolean;
}

/** pLDDT color scheme matching AlphaFold conventions */
function plddtColorFunc() {
  return {
    prop: 'b',
    gradient: 'roygb',
    min: 0,
    max: 100,
  };
}

export default function StructureViewer({ data, format = 'pdb', showControls = true }: StructureViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('spectrum');
  const [renderStyle, setRenderStyle] = useState<RenderStyle>('cartoon');

  const applyStyle = useCallback((viewer: Viewer, color: ColorMode, render: RenderStyle) => {
    let colorSpec: Record<string, unknown>;
    switch (color) {
      case 'confidence':
        colorSpec = { colorfunc: plddtColorFunc() };
        break;
      case 'chain':
        colorSpec = { color: 'chain' };
        break;
      case 'secondary':
        colorSpec = { color: 'ss' };
        break;
      case 'spectrum':
      default:
        colorSpec = { color: 'spectrum' };
        break;
    }

    const styleSpec: Record<string, unknown> = {};
    switch (render) {
      case 'stick':
        styleSpec.stick = colorSpec;
        break;
      case 'sphere':
        styleSpec.sphere = { ...colorSpec, radius: 0.6 };
        break;
      case 'cartoon':
      default:
        styleSpec.cartoon = colorSpec;
        break;
    }

    viewer.setStyle({}, styleSpec);
    viewer.render();
  }, []);

  useEffect(() => {
    if (!containerRef.current || !data || !window.$3Dmol) return;

    if (viewerRef.current) {
      viewerRef.current.clear();
      viewerRef.current = null;
    }
    containerRef.current.innerHTML = '';

    const viewer = window.$3Dmol.createViewer(containerRef.current, {
      backgroundColor: '#f8fafc',
    });
    viewerRef.current = viewer;

    const fmt = format === 'cif' ? 'mmcif' : format;
    viewer.addModel(data, fmt);
    applyStyle(viewer, colorMode, renderStyle);
    viewer.zoomTo();
    viewer.render();

    return () => {
      if (viewerRef.current) {
        viewerRef.current.clear();
        viewerRef.current = null;
      }
    };
    // Only re-create viewer when data/format changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, format]);

  // Re-apply style when colorMode or renderStyle changes (without recreating viewer)
  useEffect(() => {
    if (viewerRef.current) {
      applyStyle(viewerRef.current, colorMode, renderStyle);
    }
  }, [colorMode, renderStyle, applyStyle]);

  if (!window.$3Dmol) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
        3Dmol.js not loaded. Check your network connection.
      </div>
    );
  }

  return (
    <div>
      {showControls && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Color:</span>
            {(['spectrum', 'confidence', 'chain', 'secondary'] as ColorMode[]).map((mode) => (
              <button
                key={mode}
                className={`pill-sm${colorMode === mode ? ' active' : ''}`}
                onClick={() => setColorMode(mode)}
              >
                {mode === 'confidence' ? 'pLDDT' : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Style:</span>
            {(['cartoon', 'stick', 'sphere'] as RenderStyle[]).map((style) => (
              <button
                key={style}
                className={`pill-sm${renderStyle === style ? ' active' : ''}`}
                onClick={() => setRenderStyle(style)}
              >
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: 450,
          position: 'relative',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid #E2E8F0',
        }}
      />
      {colorMode === 'confidence' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 10, color: '#64748B' }}>
          <span>pLDDT:</span>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: '#EF4444' }} /> &lt;50
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: '#F59E0B', marginLeft: 4 }} /> 50-70
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: '#3B82F6', marginLeft: 4 }} /> 70-90
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: '#10B981', marginLeft: 4 }} /> &gt;90
        </div>
      )}
    </div>
  );
}
