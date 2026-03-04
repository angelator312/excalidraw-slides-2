import mongoose, { Schema, Document, Types } from 'mongoose';

export type Visibility = 'public' | 'private' | 'team-only';

export interface IPresentation extends Document {
  _id: Types.ObjectId;
  title: string;
  ownerUserId: Types.ObjectId;
  teamId?: Types.ObjectId;
  visibility: Visibility;
  /** Explicit user IDs allowed to edit (in addition to owner/team) */
  editorUserIds: Types.ObjectId[];
  /** Explicit user IDs allowed to view (used only when visibility=private) */
  viewerUserIds: Types.ObjectId[];
  slideCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const PresentationSchema = new Schema<IPresentation>(
  {
    title: { type: String, required: true, maxlength: 120, trim: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    visibility: {
      type: String,
      enum: ['public', 'private', 'team-only'],
      default: 'private',
    },
    editorUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    viewerUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    slideCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

PresentationSchema.index({ ownerUserId: 1, updatedAt: -1 });
PresentationSchema.index({ teamId: 1 });
PresentationSchema.index({ visibility: 1 });

export const Presentation = mongoose.model<IPresentation>('Presentation', PresentationSchema);
