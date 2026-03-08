import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  username: string;             // unique, case-insensitive, alphanum + _
  displayName: string;
  role: 'owner' | 'user' | 'anonymous';
  passwordHash?: string;        // not used for invite-token-based auth; reserved
  createdAt: Date;
  lastSeen: Date;
}

const UserSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9_]{2,40}$/,
    },
    displayName: { type: String, required: true, maxlength: 60 },
    role: { type: String, enum: ['owner', 'user', 'anonymous'], default: 'user' },
    passwordHash: { type: String },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

UserSchema.index({ username: 1 }, { unique: true });

export const User = mongoose.model<IUser>('User', UserSchema);
