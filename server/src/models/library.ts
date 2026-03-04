import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * An Excalidraw element library attached to a presentation.
 * Libraries are arrays of Excalidraw library items that can be loaded
 * into the viewer when displaying slides.
 */
export interface ILibrary extends Document {
  _id: Types.ObjectId;
  presentationId: Types.ObjectId;
  name: string;
  /** Raw Excalidraw library JSON (array of library items) */
  libraryData: Record<string, unknown>;
  /** File size in bytes for quota tracking */
  sizeBytes: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LibrarySchema = new Schema<ILibrary>(
  {
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true },
    name: { type: String, required: true, maxlength: 120, trim: true },
    libraryData: { type: Schema.Types.Mixed, required: true },
    sizeBytes: { type: Number, required: true, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

LibrarySchema.index({ presentationId: 1 });

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

export const Library = mongoose.model<ILibrary>('Library', LibrarySchema);
