import type { SlideRef } from './slideModel';

export interface ExportOptions {
  includeThumbnails: boolean;
  dpi: 1 | 2;
  notesFormat: 'markdown' | 'txt';
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeThumbnails: true,
  dpi: 2,
  notesFormat: 'markdown',
};

/**
 * Capture a slide element as a PNG data URL.
 * Falls back to a blank canvas if html2canvas is unavailable (e.g., in tests).
 */
export async function captureSlideAsPng(
  element: HTMLElement,
  scale = 2,
): Promise<string> {
  // Dynamically import html2canvas to allow tree-shaking when not used
  const h2c = await import('html2canvas').then((m) => m.default).catch(() => null);
  if (!h2c) {
    // Fallback: blank canvas
    const canvas = document.createElement('canvas');
    canvas.width = element.offsetWidth * scale;
    canvas.height = element.offsetHeight * scale;
    return canvas.toDataURL('image/png');
  }
  const canvas = await h2c(element, { scale, useCORS: true, logging: false });
  return canvas.toDataURL('image/png');
}

/**
 * Export all slides as separate PNG files using the browser's download API.
 */
export async function exportSlidesAsPng(
  slideElements: HTMLElement[],
  options: Pick<ExportOptions, 'dpi'> = { dpi: 2 },
): Promise<void> {
  for (let i = 0; i < slideElements.length; i++) {
    const dataUrl = await captureSlideAsPng(slideElements[i], options.dpi);
    triggerDownload(dataUrl, `slide-${i + 1}.png`);
    // Brief pause to prevent the browser from throttling or merging download requests
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Export slide notes as a Markdown (or plain text) string.
 * Thumbnails are referenced as separate PNG files (links in Markdown).
 */
export function exportNotesAsMarkdown(
  slides: SlideRef[],
  options: Pick<ExportOptions, 'notesFormat'> = { notesFormat: 'markdown' },
): string {
  const isMarkdown = options.notesFormat === 'markdown';
  const lines: string[] = [];

  slides.forEach((slide, i) => {
    const slideNum = i + 1;
    if (isMarkdown) {
      lines.push(`## Slide ${slideNum}: ${slide.title}`);
      lines.push('');
      lines.push(`![Slide ${slideNum} thumbnail](./thumbnails/slide-${slideNum}.png)`);
      lines.push('');
      if (slide.notes) {
        lines.push(slide.notes);
      } else {
        lines.push('_No notes_');
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    } else {
      lines.push(`--- Slide ${slideNum}: ${slide.title} ---`);
      lines.push('');
      lines.push(slide.notes || '(no notes)');
      lines.push('');
    }
  });

  return lines.join('\n');
}

/**
 * Export thumbnails for each slide (separate PNG files with a "thumbnails/" path prefix).
 * Returns an array of { filename, dataUrl } for the caller to save.
 */
export async function generateThumbnails(
  slideElements: HTMLElement[],
): Promise<{ filename: string; dataUrl: string }[]> {
  const results: { filename: string; dataUrl: string }[] = [];
  for (let i = 0; i < slideElements.length; i++) {
    const dataUrl = await captureSlideAsPng(slideElements[i], 1);
    results.push({ filename: `slide-${i + 1}.png`, dataUrl });
  }
  return results;
}

function triggerDownload(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Download a text string as a file.
 */
export function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}
