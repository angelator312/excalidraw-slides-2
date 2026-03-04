import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITeam extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerUserId: Types.ObjectId;
  memberUserIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const TeamSchema = new Schema<ITeam>(
  {
    name: { type: String, required: true, maxlength: 80, trim: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    memberUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);

TeamSchema.index({ ownerUserId: 1 });

export const Team = mongoose.model<ITeam>('Team', TeamSchema);
