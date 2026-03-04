import { useState, useEffect } from 'preact/hooks';
import { apiFetch } from '../lib/api';

export interface LibraryItem {
  id: string;
  status: 'published' | 'unpublished';
  elements: unknown[];
}

interface LibraryMeta {
  _id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
}

interface Props {
  presentationId: string;
  /** Called after a library is successfully uploaded */
  onLibraryUploaded?: (meta: LibraryMeta) => void;
}

/**
 * Component for uploading an Excalidraw library JSON file (.excalidrawlib)
 * to a presentation and listing existing libraries.
 */
export function LibraryUploader({ presentationId, onLibraryUploaded }: Props) {
  const [libraries, setLibraries] = useState<LibraryMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  const loadLibraries = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<LibraryMeta[]>(
        `/api/presentations/${presentationId}/libraries`,
      );
      setLibraries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load libraries');
    } finally {
      setLoading(false);
    }
  };

  // Load on mount
  useEffect(() => { void loadLibraries(); }, []);

  const handleFileChange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!name.trim()) {
      setError('Please provide a library name before uploading');
      return;
    }

    setError('');
    setUploading(true);

    try {
      const text = await file.text();
      let libraryData: unknown;
      try {
        libraryData = JSON.parse(text);
      } catch {
        setError('Invalid JSON file');
        return;
      }

      const meta = await apiFetch<LibraryMeta>(
        `/api/presentations/${presentationId}/libraries`,
        {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), libraryData }),
        },
      );

      setLibraries((prev) => [meta, ...prev]);
      setName('');
      onLibraryUploaded?.(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      // Reset file input
      (e.target as HTMLInputElement).value = '';
    }
  };

  const deleteLibrary = async (libraryId: string) => {
    if (!confirm('Delete this library?')) return;
    try {
      await apiFetch(`/api/presentations/${presentationId}/libraries/${libraryId}`, {
        method: 'DELETE',
      });
      setLibraries((prev) => prev.filter((l) => l._id !== libraryId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div class="library-uploader" aria-label="Library management">
      <h3>Libraries</h3>

      <div class="library-upload-form">
        <input
          type="text"
          placeholder="Library name"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          maxLength={120}
          aria-label="Library name"
        />
        <label class="btn-secondary upload-label" aria-label="Upload .excalidrawlib file">
          {uploading ? 'Uploading…' : 'Upload .excalidrawlib'}
          <input
            type="file"
            accept=".excalidrawlib,.json"
            onChange={handleFileChange}
            disabled={uploading}
            style="display:none"
            aria-hidden="true"
          />
        </label>
      </div>

      {error && <p class="error-msg" role="alert">{error}</p>}

      {loading ? (
        <p class="text-muted">Loading libraries…</p>
      ) : libraries.length === 0 ? (
        <p class="text-muted">No libraries uploaded yet.</p>
      ) : (
        <ul class="library-list">
          {libraries.map((lib) => (
            <li key={lib._id} class="library-item">
              <span class="library-name">{lib.name}</span>
              <span class="text-muted">{formatBytes(lib.sizeBytes)}</span>
              <button
                class="btn-icon btn-danger"
                onClick={() => void deleteLibrary(lib._id)}
                aria-label={`Delete library ${lib.name}`}
                title="Delete"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
