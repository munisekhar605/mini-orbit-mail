import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as nodemailer from 'nodemailer';
import * as dns from 'dns/promises';
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
    return this.messageModel
      .find({
        userEmail: userEmail.toLowerCase(),
        folder: folder.toUpperCase(),
      })
      .sort({ sentAt: -1 });
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
  async sendMessage(senderEmail: string, data: { to: string; subject: string; body: string; bodyHtml?: string }) {
    // 1. Save in SENT folder of sender immediately
    const sentMessage = await this.messageModel.create({
      userEmail: senderEmail.toLowerCase(),
      folder: 'SENT',
      from: senderEmail,
      to: data.to,
      subject: data.subject,
      bodyText: data.body,
      bodyHtml: data.bodyHtml || `<p>${data.body.replace(/\n/g, '<br/>')}</p>`,
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

  // RabbitMQ Background Worker: Direct MX delivery to Google/external + DKIM 2048-bit signing
  private async processOutboundEmailJob(job: EmailJobPayload): Promise<void> {
    const senderDomain = job.senderEmail.split('@')[1]?.toLowerCase();
    const recipientDomain = job.to.split('@')[1]?.toLowerCase();

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

    let transporter: nodemailer.Transporter;

    // Check if an authenticated external relay is configured (e.g. SendGrid, Brevo, Mailgun, Gmail)
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const cleanPass = process.env.SMTP_PASS.replace(/\s+/g, '');
      const isGmail = (process.env.MAIL_HOST || '').includes('gmail.com');

      transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.MAIL_TLS === 'true',
        auth: {
          user: process.env.SMTP_USER.trim(),
          pass: cleanPass,
        },
        dkim: isGmail ? undefined : dkimConfig,
      });
      this.logger.log(`[RabbitMQ Worker] Delivering via Authenticated Relay (${process.env.MAIL_HOST || 'relay'}:${process.env.SMTP_PORT || 587}) for ${job.to}`);
    } else {
      // Direct MX Delivery: Resolve recipient's MX server on the internet (Google, Microsoft, Yahoo)
      let targetMxHost = process.env.MAIL_HOST || '127.0.0.1';
      let targetPort = Number(process.env.SMTP_PORT) || 25;

      try {
        const mxRecords = await dns.resolveMx(recipientDomain);
        if (mxRecords && mxRecords.length > 0) {
          mxRecords.sort((a, b) => a.priority - b.priority);
          targetMxHost = mxRecords[0].exchange;
          targetPort = 25; // Standard RFC 5321 MTA port
          this.logger.log(`[RabbitMQ Worker] Resolved MX for ${recipientDomain} -> ${targetMxHost}:${targetPort}`);
        }
      } catch (err: any) {
        this.logger.warn(`Could not resolve MX for ${recipientDomain}: ${err.message}. Using fallback ${targetMxHost}`);
      }

      transporter = nodemailer.createTransport({
        host: targetMxHost,
        port: targetPort,
        secure: false,
        ignoreTLS: false,
        tls: {
          rejectUnauthorized: false,
        },
        dkim: dkimConfig,
      });
    }

    try {
      const sendResult = await transporter.sendMail({
        from: `"${job.senderEmail}" <${job.senderEmail}>`,
        to: job.to,
        subject: job.subject,
        text: job.body,
        html: job.bodyHtml || `<p>${job.body.replace(/\n/g, '<br/>')}</p>`,
      });

      this.logger.log(
        `[RabbitMQ Worker] Successfully dispatched email [${job.messageId}] to ${job.to} (MessageId: ${sendResult.messageId}, DKIM: ${!!dkimConfig})`,
      );
    } catch (sendErr: any) {
      this.logger.error(
        `[RabbitMQ Worker] Delivery failed for ${job.to}: ${sendErr.message}. If port 25 is blocked by your ISP, configure SMTP_USER/SMTP_PASS in .env`,
      );

      // Create Mailer-Daemon bounce notice in the sender's INBOX so they are immediately informed
      try {
        await this.messageModel.create({
          userEmail: job.senderEmail.toLowerCase(),
          folder: 'INBOX',
          from: 'Mail Delivery System <mailer-daemon@miniorbit.local>',
          to: job.senderEmail,
          subject: `Delivery Status Notification (Failure): ${job.subject}`,
          bodyText: `Your message to ${job.to} could not be delivered.\n\nError: ${sendErr.message}\n\nTechnical Explanation:\nWhen sending from a local PC / Docker environment, your internet service provider (ISP) or local antivirus (Seqrite Endpoint Protection) blocks outbound TCP Port 25 to external mail providers (e.g. Google, Microsoft).\n\nTo enable outbound email delivery to Gmail/Outlook from local environment:\n1. Configure SMTP_USER and SMTP_PASS in .env using an SMTP relay (e.g. Brevo, SendGrid, Amazon SES, or Gmail App Password on port 587).\n2. Or deploy Mini-Orbit to a production cloud server with an open mail port.\n\nNote: Sending between mailboxes on your Mini-Orbit cluster works 100% locally without external relay.`,
          bodyHtml: `<div style="font-family: sans-serif; font-size: 13px; color: #334155; line-height: 1.6;">
            <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 14px; margin-bottom: 14px;">
              <h3 style="color: #e11d48; margin: 0 0 6px 0; font-size: 14px;">Mail Delivery Failure (Outbound Blocked)</h3>
              <p style="margin: 0; color: #9f1239; font-weight: 500;">Your message to <strong>${job.to}</strong> could not be delivered.</p>
              <div style="margin-top: 8px; font-family: monospace; font-size: 11px; background: #ffe4e6; padding: 6px 10px; border-radius: 4px; color: #881337;">
                Error: ${sendErr.message}
              </div>
            </div>
            <h4 style="margin: 12px 0 6px 0; color: #0f172a; font-size: 13px;">Why did this happen?</h4>
            <ul style="padding-left: 18px; margin: 0 0 12px 0; color: #475569;">
              <li><strong>Antivirus or ISP Port 25 Block:</strong> Standard home/office internet connections and endpoint protection software (like Seqrite) block outbound connections on Port 25.</li>
              <li><strong>External Spam Protection:</strong> Google and Outlook reject connections from residential dynamic IP addresses without reverse DNS (PTR) records.</li>
            </ul>
            <h4 style="margin: 12px 0 6px 0; color: #0f172a; font-size: 13px;">Solutions:</h4>
            <ol style="padding-left: 18px; margin: 0; color: #475569;">
              <li><strong>Local Mailboxes:</strong> Emails between users on your domains (e.g. test1@${senderDomain} to test2@${senderDomain}) work instantly and locally.</li>
              <li><strong>External Relay (Port 587):</strong> Add <code>SMTP_USER</code> and <code>SMTP_PASS</code> with Brevo, SendGrid, or Gmail App Password in your <code>.env</code> file.</li>
              <li><strong>Production Cloud Server:</strong> Deploy to your cloud VPS (103.186.134.19) where dedicated mail ports and reverse DNS are configured.</li>
            </ol>
          </div>`,
          isRead: false,
          sentAt: new Date(),
        });
      } catch (bounceErr) {
        this.logger.error('Failed to create bounce notification:', bounceErr);
      }

      throw sendErr; // Rethrow to allow RabbitMQ retry & DLQ handling
    }
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
    msg.isRead = isRead !== undefined ? isRead : !msg.isRead;
    await msg.save();
    return { isRead: msg.isRead };
  }
}

