import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ default: 'user', enum: ['admin', 'user'] })
  role: string;

  @Prop({ required: true, lowercase: true, trim: true })
  domain: string;

  @Prop({ default: 1024 }) // Quota in MB
  quotaMb: number;

  @Prop({ default: 0 })
  usedQuotaMb: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
