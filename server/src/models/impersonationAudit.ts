import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Audit record created whenever an admin impersonates another user.
 */
export interface IImpersonationAudit extends Document {
  _id: Types.ObjectId;
  /** Admin user who initiated the impersonation */
  adminId: Types.ObjectId;
  /** User being impersonated */
  targetUserId: Types.ObjectId;
  /** Action performed — 'start' when token issued */
  action: 'start';
  /** Optional reason provided by admin */
  reason?: string;
  /** IP address of the request */
  ip: string;
  createdAt: Date;
}

const ImpersonationAuditSchema = new Schema<IImpersonationAudit>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: ['start'], required: true },
    reason: { type: String, maxlength: 500 },
    ip: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ImpersonationAuditSchema.index({ adminId: 1, createdAt: -1 });
ImpersonationAuditSchema.index({ targetUserId: 1 });

export const ImpersonationAudit = mongoose.model<IImpersonationAudit>(
  'ImpersonationAudit',
  ImpersonationAuditSchema,
);
