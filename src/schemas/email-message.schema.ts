import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmailMessageDocument = EmailMessage & Document;

@Schema({ timestamps: true })
export class EmailMessage {
  @Prop({ required: true, lowercase: true, trim: true })
  userEmail: string;

  @Prop({ default: 'INBOX', enum: ['INBOX', 'SENT', 'DRAFTS', 'TRASH', 'SPAM'] })
  folder: string;

  @Prop({ required: true })
  from: string;

  @Prop({ required: true })
  to: string;

  @Prop({ default: '(No Subject)' })
  subject: string;

  @Prop({ default: '' })
  bodyHtml: string;

  @Prop({ default: '' })
  bodyText: string;

  @Prop({ default: false })
  isRead: boolean;

  @Prop({ default: false })
  isStarred: boolean;

  @Prop({ default: Date.now })
  sentAt: Date;

  @Prop({ type: Array, default: [] })
  attachments: Array<{
    filename: string;
    contentType?: string;
    size?: number;
    url?: string;
    content?: string;
  }>;
}

export const EmailMessageSchema = SchemaFactory.createForClass(EmailMessage);
