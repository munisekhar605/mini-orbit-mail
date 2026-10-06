import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as nodemailer from 'nodemailer';
import { EmailMessage, EmailMessageDocument } from '../schemas/email-message.schema';
import { Domain, DomainDocument } from '../schemas/domain.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { RabbitMQService, EmailJobPayload } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class WebmailService implements OnModuleInit {
  private readonly logger = new Logger(WebmailService.name);

  constructor(
    @InjectModel(EmailMessage.name) private messageModel: Model<EmailMessageDocument>,
    @InjectModel(Domain.name) private domainModel: Model<DomainDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private rabbitMqService: RabbitMQService,
  ) {}

  async onModuleInit() {
    // Start background RabbitMQ email consumer worker
    await this.rabbitMqService.consumeEmailJobs(this.processOutboundEmailJob.bind(this));
  }

  async getMessages(userEmail: string, folder = 'INBOX') {
    const folderUpper = folder ? folder.toUpperCase() : 'INBOX';
    const query: any = { userEmail: userEmail.toLowerCase() };
    if (folderUpper === 'STARRED') {
      query.isStarred = true;
    } else if (folderUpper !== 'ALL') {
      query.folder = folderUpper;
    }
    return this.messageModel.find(query).sort({ sentAt: -1 });
  }

  async getMessage(id: string, userEmail: string) {
    const msg = await this.messageModel.findOne({
      _id: id,
      userEmail: userEmail.toLowerCase(),
    });
    if (!msg) {
      throw new NotFoundException('Message not found');
    }
    if (!msg.isRead) {
      msg.isRead = true;
      await msg.save();
    }
    return msg;
  }

  // Fast HTTP Producer: Saves to DB & enqueues to RabbitMQ in milliseconds
  async sendMessage(senderEmail: string, data: { to: string; subject: string; body: string; bodyHtml?: string; attachments?: any[] }) {
    // 1. Save in SENT folder of sender immediately
    const sentMessage = await this.messageModel.create({
      userEmail: senderEmail.toLowerCase(),
      folder: 'SENT',
      from: senderEmail,
      to: data.to,
      subject: data.subject,
      bodyText: data.body,
      bodyHtml: data.bodyHtml || `<p>${data.body.replace(/\n/g, '<br/>')}</p>`,
      attachments: data.attachments || [],
      isRead: true,
      sentAt: new Date(),
    });

    // 2. If recipient is a local mailbox on our cluster, deliver directly to their INBOX
    const localRecipient = await this.userModel.findOne({ email: data.to.toLowerCase() });
    if (localRecipient) {
      await this.messageModel.create({
        userEmail: data.to.toLowerCase(),
        folder: 'INBOX',
        from: senderEmail,
        to: data.to,
        subject: data.subject,
        bodyText: data.body,
        bodyHtml: data.bodyHtml || `<p>${data.body.replace(/\n/g, '<br/>')}</p>`,
        attachments: data.attachments || [],
        isRead: false,
        sentAt: new Date(),
      });
    }

    // 3. Push to RabbitMQ enterprise queue for background DKIM signing & SMTP dispatch
    const queued = await this.rabbitMqService.publishEmailJob({
      messageId: sentMessage._id.toString(),
      senderEmail,
      to: data.to,
      subject: data.subject,
      body: data.body,
      bodyHtml: data.bodyHtml,
    });

    return {
      message: 'Email queued for delivery successfully',
      queuedViaRabbitMQ: queued,
      email: sentMessage,
    };
  }

  // RabbitMQ Background Worker: Signs DKIM and dispatches over SMTP to Google / external servers
  private async processOutboundEmailJob(job: EmailJobPayload): Promise<void> {
    const host = process.env.MAIL_HOST || '127.0.0.1';
    const port = Number(process.env.SMTP_PORT) || 587;
    const senderDomain = job.senderEmail.split('@')[1]?.toLowerCase();

    // Fetch the 2048-bit RSA private key for authentic DKIM digital signing
    const domainRecord = await this.domainModel
      .findOne({ name: senderDomain })
      .select('+dkimPrivateKey');

    let dkimConfig: any = undefined;
    if (domainRecord && domainRecord.dkimPrivateKey) {
      dkimConfig = {
        domainName: domainRecord.name,
        keySelector: domainRecord.dkimSelector || 'default',
        privateKey: domainRecord.dkimPrivateKey,
      };
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.MAIL_TLS === 'true',
      ignoreTLS: process.env.NODE_ENV !== 'production',
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
      dkim: dkimConfig,
    });

    await transporter.sendMail({
      from: `"${job.senderEmail}" <${job.senderEmail}>`,
      to: job.to,
      subject: job.subject,
      text: job.body,
      html: job.bodyHtml || `<p>${job.body.replace(/\n/g, '<br/>')}</p>`,
    });

    this.logger.log(`[RabbitMQ Worker] Dispatched email [${job.messageId}] to ${job.to} (DKIM: ${!!dkimConfig})`);
  }

  // Inbound delivery endpoint for external emails arriving from Postfix or external webhook
  async handleInboundEmail(payload: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) {
    const recipientEmail = payload.to.toLowerCase();
    const recipientUser = await this.userModel.findOne({ email: recipientEmail, isActive: true });

    if (!recipientUser) {
      throw new NotFoundException(`Recipient mailbox "${recipientEmail}" does not exist on this cluster`);
    }

    const message = await this.messageModel.create({
      userEmail: recipientEmail,
      folder: 'INBOX',
      from: payload.from,
      to: recipientEmail,
      subject: payload.subject || '(No Subject)',
      bodyText: payload.text || '',
      bodyHtml: payload.html || (payload.text ? `<p>${payload.text.replace(/\n/g, '<br/>')}</p>` : ''),
      isRead: false,
      isStarred: false,
      sentAt: new Date(),
    });

    return { success: true, messageId: message._id };
  }

  async toggleStar(id: string, userEmail: string) {
    const msg = await this.messageModel.findOne({ _id: id, userEmail: userEmail.toLowerCase() });
    if (!msg) throw new NotFoundException('Message not found');
    msg.isStarred = !msg.isStarred;
    await msg.save();
    return { isStarred: msg.isStarred };
  }

  async moveToTrash(id: string, userEmail: string) {
    const msg = await this.messageModel.findOne({ _id: id, userEmail: userEmail.toLowerCase() });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.folder === 'TRASH') {
      await this.messageModel.findByIdAndDelete(id);
      return { message: 'Message permanently deleted' };
    } else {
      msg.folder = 'TRASH';
      await msg.save();
      return { message: 'Message moved to trash' };
    }
  }

  async moveToFolder(id: string, userEmail: string, folder: string) {
    const msg = await this.messageModel.findOne({ _id: id, userEmail: userEmail.toLowerCase() });
    if (!msg) throw new NotFoundException('Message not found');
    msg.folder = folder.toUpperCase();
    await msg.save();
    return { success: true, folder: msg.folder };
  }

  async toggleRead(id: string, userEmail: string, isRead?: boolean) {
    const msg = await this.messageModel.findOne({ _id: id, userEmail: userEmail.toLowerCase() });
    if (!msg) throw new NotFoundException('Message not found');
    msg.isRead = typeof isRead === 'boolean' ? isRead : !msg.isRead;
    await msg.save();
    return { success: true, isRead: msg.isRead };
  }
}
