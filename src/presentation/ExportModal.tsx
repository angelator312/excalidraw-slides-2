import { useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { SlideRef } from './slideModel';
import {
  exportSlidesAsPng,
  exportNotesAsMarkdown,
  downloadText,
  generateThumbnails,
} from './export';

interface Props {
  slides: SlideRef[];
  slideElementRefs: RefObject<Map<number, HTMLElement>>;
  onClose: () => void;
}

export function ExportModal({ slides, slideElementRefs, onClose }: Props) {
  const [exporting, setExporting] = useState<'png' | 'notes' | 'thumbnails' | null>(null);
  const [dpi, setDpi] = useState<1 | 2>(2);
  const [notesFormat, setNotesFormat] = useState<'markdown' | 'txt'>('markdown');

  const getElements = (): HTMLElement[] => {
    const map = slideElementRefs.current;
    if (!map) return [];
    return slides.map((_, i) => map.get(i)).filter(Boolean) as HTMLElement[];
  };

  const handleExportPng = async () => {
    setExporting('png');
    try {
      await exportSlidesAsPng(getElements(), { dpi });
    } finally {
      setExporting(null);
    }
  };

  const handleExportNotes = () => {
    setExporting('notes');
    try {
      const content = exportNotesAsMarkdown(slides, { notesFormat });
      const ext = notesFormat === 'markdown' ? 'md' : 'txt';
      downloadText(content, `notes.${ext}`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportThumbnails = async () => {
    setExporting('thumbnails');
    try {
      const thumbs = await generateThumbnails(getElements());
      thumbs.forEach(({ filename, dataUrl }) => {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `thumbnails/${filename}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Export">
      <div class="modal-box">
        <div class="modal-header">
          <h2>Export</h2>
          <button class="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div class="export-options">
          <section>
            <h3>Slides as PNG</h3>
            <label>
              DPI scale:
              <select
                value={dpi}
                onChange={(e) => setDpi(Number((e.target as HTMLSelectElement).value) as 1 | 2)}
                aria-label="DPI scale"
              >
                <option value={1}>1× (standard)</option>
                <option value={2}>2× (retina)</option>
              </select>
            </label>
            <button
              class="btn-primary"
              onClick={() => void handleExportPng()}
              disabled={!!exporting}
            >
              {exporting === 'png' ? 'Exporting…' : 'Download PNGs'}
            </button>
          </section>

          <section>
            <h3>Notes</h3>
            <label>
              Format:
              <select
                value={notesFormat}
                onChange={(e) =>
                  setNotesFormat((e.target as HTMLSelectElement).value as 'markdown' | 'txt')
                }
                aria-label="Notes format"
              >
                <option value="markdown">Markdown (with thumbnail links)</option>
                <option value="txt">Plain text</option>
              </select>
            </label>
            <button
              class="btn-secondary"
              onClick={handleExportNotes}
              disabled={!!exporting}
            >
              {exporting === 'notes' ? 'Exporting…' : 'Download Notes'}
            </button>
          </section>

          <section>
            <h3>Thumbnails (separate files)</h3>
            <p class="text-muted">Saves each slide thumbnail as a PNG in a <code>thumbnails/</code> folder.</p>
            <button
              class="btn-secondary"
              onClick={() => void handleExportThumbnails()}
              disabled={!!exporting}
            >
              {exporting === 'thumbnails' ? 'Exporting…' : 'Download Thumbnails'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
