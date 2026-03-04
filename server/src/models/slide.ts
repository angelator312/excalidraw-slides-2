import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISlide extends Document {
  _id: Types.ObjectId;
  presentationId: Types.ObjectId;
  index: number;
  title: string;
  sceneJSON: Record<string, unknown>;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const SlideSchema = new Schema<ISlide>(
  {
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true },
    index: { type: Number, required: true },
    title: { type: String, default: '', maxlength: 200 },
    sceneJSON: { type: Schema.Types.Mixed, default: { type: 'excalidraw', version: 2, elements: [] } },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);

SlideSchema.index({ presentationId: 1, index: 1 });

export const Slide = mongoose.model<ISlide>('Slide', SlideSchema);
