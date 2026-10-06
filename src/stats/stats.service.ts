import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Domain, DomainDocument } from '../schemas/domain.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { EmailMessage, EmailMessageDocument } from '../schemas/email-message.schema';

@Injectable()
export class StatsService {
  constructor(
    @InjectModel(Domain.name) private domainModel: Model<DomainDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(EmailMessage.name) private messageModel: Model<EmailMessageDocument>,
  ) {}

  async getStats() {
    const totalDomains = await this.domainModel.countDocuments();
    const totalMailboxes = await this.userModel.countDocuments();
    const activeDomains = await this.domainModel.countDocuments({ status: 'active' });
    const totalEmails = await this.messageModel.countDocuments();

    return {
      totalDomains,
      activeDomains,
      totalMailboxes,
      totalEmails,
      systemHealth: 'OPERATIONAL',
      engine: 'Mini Orbit Engine + MongoDB',
      version: '1.0.0',
    };
  }
}
