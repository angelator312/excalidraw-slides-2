/**
 * Pure validation helpers for Excalidraw library JSON.
 * No external dependencies — safe to import in both server and browser environments.
 */

/** Maximum allowed library JSON size: 2 MB */
export const MAX_LIBRARY_SIZE_BYTES = 2 * 1024 * 1024;

/** Validate that the parsed library JSON has the expected Excalidraw library shape */
export function validateLibraryData(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const lib = data as Record<string, unknown>;
  // Excalidraw library format: { type: "excalidrawlib", version: number, library: [...] }
  // OR the older format: { libraryItems: [...] }
  if (
    (lib['type'] === 'excalidrawlib' && Array.isArray(lib['library'])) ||
    Array.isArray(lib['libraryItems'])
  ) {
    return true;
  }
  return false;
}
