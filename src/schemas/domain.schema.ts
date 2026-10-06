import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DomainDocument = Domain & Document;

@Schema({ timestamps: true })
export class Domain {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  name: string;

  @Prop({ default: 50 })
  maxUsers: number;

  @Prop({ default: 50000 })
  maxQuotaMb: number;

  @Prop({ default: 'active', enum: ['active', 'pending', 'error'] })
  status: string;

  @Prop({ default: 'default' })
  dkimSelector: string;

  @Prop({ default: '' })
  dkimPublicKey: string;

  @Prop({ default: '', select: false }) // Private key hidden from normal queries for security
  dkimPrivateKey: string;

  @Prop({ default: '' })
  spfRecord: string;

  @Prop({ default: '' })
  dmarcRecord: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const DomainSchema = SchemaFactory.createForClass(Domain);
