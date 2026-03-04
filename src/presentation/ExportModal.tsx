import { useState } from 'preact/hooks';
import type { SlideRef } from './slideModel';

interface Props {
  slides: SlideRef[];
  slideElementRefs: import('preact').RefObject<Map<number, HTMLElement>>;
  onClose: () => void;
}

async function exportSlideWithExcalidraw(
  slide: SlideRef,
  format: 'png' | 'svg',
  scale = 2,
): Promise<Blob | string> {
  const { exportToBlob, exportToSvg } = await import('@excalidraw/excalidraw');
  const elements = (slide.sceneJSON?.elements ?? []) as Parameters<typeof exportToBlob>[0]['elements'];
  const appState = {
    exportWithDarkMode: false,
    exportBackground: true,
    ...(slide.sceneJSON?.appState ?? {}),
  } as Parameters<typeof exportToBlob>[0]['appState'];
  const files = (slide.sceneJSON?.files ?? {}) as Parameters<typeof exportToBlob>[0]['files'];

  if (format === 'svg') {
    const svg = await exportToSvg({ elements, appState, files });
    return new XMLSerializer().serializeToString(svg);
  }
  return exportToBlob({ elements, appState, files, mimeType: 'image/png', quality: 1, scale });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadText(text: string, filename: string, mimeType = 'text/plain') {
  const blob = new Blob([text], { type: mimeType });
  downloadBlob(blob, filename);
}

function exportNotesAsMarkdown(slides: SlideRef[], format: 'markdown' | 'txt'): string {
  const lines: string[] = [];
  slides.forEach((slide, i) => {
    const num = i + 1;
    if (format === 'markdown') {
      lines.push(`## Slide ${num}: ${slide.title}`, '', slide.notes || '_No notes_', '', '---', '');
    } else {
      lines.push(`--- Slide ${num}: ${slide.title} ---`, '', slide.notes || '(no notes)', '');
    }
  });
  return lines.join('\n');
}

export function ExportModal({ slides, onClose }: Props) {
  const [exporting, setExporting] = useState<'png' | 'svg' | 'notes' | null>(null);
  const [scale, setScale] = useState<1 | 2>(2);
  const [notesFormat, setNotesFormat] = useState<'markdown' | 'txt'>('markdown');
  const [exportError, setExportError] = useState('');

  const handleExportAllPng = async () => {
    setExporting('png');
    setExportError('');
    try {
      for (let i = 0; i < slides.length; i++) {
        const blob = await exportSlideWithExcalidraw(slides[i], 'png', scale);
        if (blob instanceof Blob) downloadBlob(blob, `slide-${i + 1}.png`);
        await new Promise((r) => setTimeout(r, 80));
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const handleExportAllSvg = async () => {
    setExporting('svg');
    setExportError('');
    try {
      for (let i = 0; i < slides.length; i++) {
        const svg = await exportSlideWithExcalidraw(slides[i], 'svg');
        if (typeof svg === 'string') downloadText(svg, `slide-${i + 1}.svg`, 'image/svg+xml');
        await new Promise((r) => setTimeout(r, 80));
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const handleExportNotes = () => {
    const ext = notesFormat === 'markdown' ? 'md' : 'txt';
    const content = exportNotesAsMarkdown(slides, notesFormat);
    const blob = new Blob([content], { type: 'text/plain' });
    downloadBlob(blob, `notes.${ext}`);
  };

  return (
    <div
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Export"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div class="modal-box">
        <div class="modal-header">
          <h2>Export</h2>
          <button class="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div class="export-options">
          {exportError && <p class="error-msg" role="alert">{exportError}</p>}

          <section class="export-section">
            <h3>Export as PNG <span class="text-muted">(via Excalidraw)</span></h3>
            <label class="export-label">
              Scale:
              <select
                value={scale}
                onChange={(e) => setScale(Number((e.target as HTMLSelectElement).value) as 1 | 2)}
                aria-label="Export scale"
              >
                <option value={1}>1× standard</option>
                <option value={2}>2× retina</option>
              </select>
            </label>
            <button
              class="btn-primary"
              onClick={() => void handleExportAllPng()}
              disabled={!!exporting}
            >
              {exporting === 'png' ? 'Exporting…' : `Download ${slides.length} PNG${slides.length !== 1 ? 's' : ''}`}
            </button>
          </section>

          <section class="export-section">
            <h3>Export as SVG <span class="text-muted">(via Excalidraw)</span></h3>
            <button
              class="btn-secondary"
              onClick={() => void handleExportAllSvg()}
              disabled={!!exporting}
            >
              {exporting === 'svg' ? 'Exporting…' : `Download ${slides.length} SVG${slides.length !== 1 ? 's' : ''}`}
            </button>
          </section>

          <section class="export-section">
            <h3>Speaker notes</h3>
            <label class="export-label">
              Format:
              <select
                value={notesFormat}
                onChange={(e) => setNotesFormat((e.target as HTMLSelectElement).value as 'markdown' | 'txt')}
                aria-label="Notes format"
              >
                <option value="markdown">Markdown</option>
                <option value="txt">Plain text</option>
              </select>
            </label>
            <button
              class="btn-secondary"
              onClick={handleExportNotes}
              disabled={!!exporting}
            >
              Download notes
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
