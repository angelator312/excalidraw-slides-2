import mongoose, { Schema, Document, Types } from 'mongoose';

export type TeamMemberRole = 'editor' | 'viewer';

export interface ITeamMemberRole {
  userId: Types.ObjectId;
  role: TeamMemberRole;
}

export interface ITeam extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerUserId: Types.ObjectId;
  memberUserIds: Types.ObjectId[];
  /** Per-member roles (editor can edit team presentations; viewer can only view) */
  memberRoles: ITeamMemberRole[];
  createdAt: Date;
  updatedAt: Date;
}

const TeamMemberRoleSchema = new Schema<ITeamMemberRole>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['editor', 'viewer'], default: 'viewer' },
  },
  { _id: false },
);

const TeamSchema = new Schema<ITeam>(
  {
    name: { type: String, required: true, maxlength: 80, trim: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    memberUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    memberRoles: { type: [TeamMemberRoleSchema], default: [] },
  },
  { timestamps: true },
);

TeamSchema.index({ ownerUserId: 1 });

export const Team = mongoose.model<ITeam>('Team', TeamSchema);
