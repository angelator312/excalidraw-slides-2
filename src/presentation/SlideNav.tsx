import { useState } from 'preact/hooks';
import { apiFetch } from '../lib/api';
import type { SlideRef } from './slideModel';

/** Maximum length for a slide title (shared constant) */
const MAX_SLIDE_TITLE_LENGTH = 120;

interface Props {
  slides: SlideRef[];
  currentIndex: number;
  onSelect: (index: number) => void;
  canEdit: boolean;
  presentationId: string;
  onSlidesChange: (slides: SlideRef[]) => void;
  onRename?: (slideId: string, title: string) => Promise<void>;
  thumbnails?: Map<string, string>;
  style?: Record<string, string>;
}

export function SlideNav({
  slides,
  currentIndex,
  onSelect,
  canEdit,
  presentationId,
  onSlidesChange,
  onRename,
  thumbnails,
  style,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

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

  const startEditing = (slide: SlideRef) => {
    if (!canEdit) return;
    setEditingId(slide.id);
    setEditingTitle(slide.title || `Slide ${slides.indexOf(slide) + 1}`);
  };

  const commitRename = async (slideId: string) => {
    const title = editingTitle.trim();
    setEditingId(null);
    if (!title) return;
    await onRename?.(slideId, title);
  };

  return (
    <aside class="slide-nav" aria-label="Slide list" style={style}>
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
        {slides.map((s, i) => {
          const thumb = thumbnails?.get(s.id);
          const isActive = i === currentIndex;
          const isEditing = editingId === s.id;
          return (
            <li
              key={s.id}
              class={`slide-nav-item ${isActive ? 'active' : ''}`}
              role="option"
              aria-selected={isActive}
            >
              <button
                class="slide-nav-btn"
                onClick={() => onSelect(i)}
                aria-label={`Slide ${i + 1}: ${s.title}`}
              >
                {/* Thumbnail */}
                <div class="slide-thumb" aria-hidden="true">
                  {thumb ? (
                    <img src={thumb} alt="" class="slide-thumb-img" />
                  ) : (
                    <div class="slide-thumb-placeholder">
                      <span class="slide-num">{i + 1}</span>
                    </div>
                  )}
                </div>

                {/* Label / inline editor */}
                {isEditing ? (
                  <input
                    class="slide-title-input"
                    value={editingTitle}
                    onInput={(e) => setEditingTitle((e.target as HTMLInputElement).value)}
                    onBlur={() => void commitRename(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(s.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    maxLength={MAX_SLIDE_TITLE_LENGTH}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    aria-label="Rename slide"
                  />
                ) : (
                  <span
                    class="slide-label"
                    onDblClick={(e) => { e.stopPropagation(); startEditing(s); }}
                    title={canEdit ? 'Double-click to rename' : undefined}
                  >
                    {s.title || `Slide ${i + 1}`}
                  </span>
                )}
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
          );
        })}
      </ul>
    </aside>
  );
}
