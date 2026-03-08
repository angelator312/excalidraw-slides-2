import mongoose, { Schema, Document, Types } from 'mongoose';

/** Maximum number of automatic versions retained per slide */
export const MAX_AUTO_VERSIONS = 50;

export type VersionType = 'auto' | 'snapshot';

export interface IVersion extends Document {
  _id: Types.ObjectId;
  slideId: Types.ObjectId;
  presentationId: Types.ObjectId;
  sceneJSON: Record<string, unknown>;
  type: VersionType;
  /** Snapshot-only metadata */
  name?: string;
  description?: string;
  /** User who created (null for auto) */
  createdBy?: Types.ObjectId;
  createdAt: Date;
}

const VersionSchema = new Schema<IVersion>(
  {
    slideId: { type: Schema.Types.ObjectId, ref: 'Slide', required: true },
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true },
    sceneJSON: { type: Schema.Types.Mixed, required: true },
    type: { type: String, enum: ['auto', 'snapshot'], required: true },
    name: { type: String, maxlength: 80 },
    description: { type: String, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

VersionSchema.index({ slideId: 1, createdAt: -1 });
VersionSchema.index({ presentationId: 1 });

export const Version = mongoose.model<IVersion>('Version', VersionSchema);
