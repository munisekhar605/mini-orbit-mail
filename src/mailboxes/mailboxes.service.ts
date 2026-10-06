import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../schemas/user.schema';
import { Domain, DomainDocument } from '../schemas/domain.schema';

@Injectable()
export class MailboxesService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Domain.name) private domainModel: Model<DomainDocument>,
  ) {}

  async findAll(domain?: string) {
    const filter = domain ? { domain: domain.toLowerCase() } : {};
    return this.userModel.find(filter).select('-passwordHash').sort({ createdAt: -1 });
  }

  async findOne(id: string) {
    const user = await this.userModel.findById(id).select('-passwordHash');
    if (!user) {
      throw new NotFoundException('Mailbox not found');
    }
    return user;
  }

  async create(data: { email: string; password: string; quotaMb?: number; role?: string }) {
    const cleanEmail = data.email.trim().toLowerCase();
    const existing = await this.userModel.findOne({ email: cleanEmail });
    if (existing) {
      throw new BadRequestException(`Mailbox "${cleanEmail}" already exists`);
    }

    const domainPart = cleanEmail.split('@')[1];
    if (!domainPart) {
      throw new BadRequestException('Invalid email format');
    }

    // Check or auto-create domain
    let domain = await this.domainModel.findOne({ name: domainPart });
    if (!domain) {
      domain = await this.domainModel.create({
        name: domainPart,
        status: 'active',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.password, salt);

    const user = await this.userModel.create({
      email: cleanEmail,
      passwordHash,
      domain: domainPart,
      quotaMb: data.quotaMb || 2048,
      role: data.role || 'user',
      isActive: true,
    });

    return {
      message: 'Mailbox created successfully',
      mailbox: {
        id: user._id,
        email: user.email,
        domain: user.domain,
        quotaMb: user.quotaMb,
        role: user.role,
      },
    };
  }

  async update(id: string, data: { quotaMb?: number; password?: string; isActive?: boolean }) {
    const user = await this.userModel.findById(id);
    if (!user) {
      throw new NotFoundException('Mailbox not found');
    }

    if (data.quotaMb !== undefined) user.quotaMb = data.quotaMb;
    if (data.isActive !== undefined) user.isActive = data.isActive;
    if (data.password) {
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(data.password, salt);
    }

    await user.save();
    return {
      message: 'Mailbox updated successfully',
      mailbox: {
        id: user._id,
        email: user.email,
        quotaMb: user.quotaMb,
        isActive: user.isActive,
      },
    };
  }

  async delete(id: string) {
    const user = await this.userModel.findById(id);
    if (!user) {
      throw new NotFoundException('Mailbox not found');
    }
    await this.userModel.findByIdAndDelete(id);
    return { message: `Mailbox "${user.email}" deleted successfully` };
  }
}
