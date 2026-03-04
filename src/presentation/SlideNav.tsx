import { useState } from 'preact/hooks';
import { apiFetch } from '../lib/api';
import type { SlideRef } from './slideModel';

interface Props {
  slides: SlideRef[];
  currentIndex: number;
  onSelect: (index: number) => void;
  canEdit: boolean;
  presentationId: string;
  onSlidesChange: (slides: SlideRef[]) => void;
}

export function SlideNav({
  slides,
  currentIndex,
  onSelect,
  canEdit,
  presentationId,
  onSlidesChange,
}: Props) {
  const [adding, setAdding] = useState(false);

  const addSlide = async () => {
    if (!canEdit) return;
    setAdding(true);
    try {
      const newSlide = await apiFetch<SlideRef>(`/api/presentations/${presentationId}/slides`, {
        method: 'POST',
        body: JSON.stringify({
          index: slides.length,
          sceneJSON: { type: 'excalidraw', version: 2, elements: [] },
          notes: '',
        }),
      });
      onSlidesChange([...slides, newSlide]);
      onSelect(slides.length);
    } finally {
      setAdding(false);
    }
  };

  const deleteSlide = async (slideId: string, index: number) => {
    if (!canEdit || slides.length <= 1) return;
    if (!confirm('Delete this slide?')) return;
    try {
      await apiFetch(`/api/presentations/${presentationId}/slides/${slideId}`, { method: 'DELETE' });
      const updated = slides.filter((_, i) => i !== index).map((s, i) => ({ ...s, index: i }));
      onSlidesChange(updated);
      onSelect(Math.min(index, updated.length - 1));
    } catch { /* ignore */ }
  };

  return (
    <aside class="slide-nav" aria-label="Slide list">
      <div class="slide-nav-header">
        <span class="slide-nav-title">Slides</span>
        {canEdit && (
          <button
            class="btn-icon"
            onClick={addSlide}
            disabled={adding}
            aria-label="Add slide"
            title="Add slide"
          >
            +
          </button>
        )}
      </div>
      <ul class="slide-nav-list" role="listbox" aria-label="Slides">
        {slides.map((s, i) => (
          <li
            key={s.id}
            class={`slide-nav-item ${i === currentIndex ? 'active' : ''}`}
            role="option"
            aria-selected={i === currentIndex}
          >
            <button
              class="slide-nav-btn"
              onClick={() => onSelect(i)}
              aria-label={`Slide ${i + 1}: ${s.title}`}
            >
              <span class="slide-num">{i + 1}</span>
              <span class="slide-label">{s.title}</span>
            </button>
            {canEdit && slides.length > 1 && (
              <button
                class="btn-icon slide-delete-btn"
                onClick={() => void deleteSlide(s.id, i)}
                aria-label={`Delete slide ${i + 1}`}
                title="Delete slide"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
