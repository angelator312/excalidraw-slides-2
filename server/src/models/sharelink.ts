import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IShareLink extends Document {
  _id: Types.ObjectId;
  token: string;
  presentationId: Types.ObjectId;
  role: 'view' | 'edit';
  createdBy: Types.ObjectId;
  expiresAt?: Date;
  createdAt: Date;
}

const ShareLinkSchema = new Schema<IShareLink>(
  {
    token: { type: String, required: true, unique: true },
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true },
    role: { type: String, enum: ['view', 'edit'], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ShareLinkSchema.index({ token: 1 }, { unique: true });
ShareLinkSchema.index({ presentationId: 1 });
ShareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

export const ShareLink = mongoose.model<IShareLink>('ShareLink', ShareLinkSchema);
