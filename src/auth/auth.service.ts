import { Injectable, BadRequestException, UnauthorizedException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../schemas/user.schema';
import { Domain, DomainDocument } from '../schemas/domain.schema';
import { generateDomainSecurityRecords } from '../common/utils/dns-crypto.util';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Domain.name) private domainModel: Model<DomainDocument>,
    private jwtService: JwtService,
  ) {}

  async onModuleInit() {
    // Seed default admin and default domain if empty
    try {
      const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@orbitmail.local';
      const existingAdmin = await this.userModel.findOne({ email: adminEmail });
      if (!existingAdmin) {
        const domainPart = adminEmail.split('@')[1];
        let domain = await this.domainModel.findOne({ name: domainPart });
        if (!domain) {
          const sec = generateDomainSecurityRecords(domainPart);
          domain = await this.domainModel.create({
            name: domainPart,
            status: 'active',
            dkimSelector: sec.dkimSelector,
            dkimPublicKey: sec.dkimPublicKey,
            dkimPrivateKey: sec.dkimPrivateKey,
            spfRecord: sec.spfRecord,
            dmarcRecord: sec.dmarcRecord,
          });
        }

        const password = process.env.INITIAL_ADMIN_PASSWORD || 'AdminPassword123!';
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        await this.userModel.create({
          email: adminEmail,
          passwordHash,
          role: 'admin',
          domain: domainPart,
          quotaMb: 10240,
          isActive: true,
        });
        console.log(`[AuthService] Seeded default admin user: ${adminEmail}`);
      }
    } catch (err: any) {
      console.warn('[AuthService] Could not auto-seed admin user (MongoDB may be connecting):', err?.message || err);
    }
  }

  async register(data: { email: string; password: string; domain?: string; role?: string }) {
    const existing = await this.userModel.findOne({ email: data.email.toLowerCase() });
    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }

    const domainName = data.domain || data.email.split('@')[1];
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.password, salt);

    const user = await this.userModel.create({
      email: data.email.toLowerCase(),
      passwordHash,
      role: data.role || 'user',
      domain: domainName.toLowerCase(),
      quotaMb: 2048,
      isActive: true,
    });

    const token = this.generateToken(user);
    return {
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        domain: user.domain,
        quotaMb: user.quotaMb,
      },
    };
  }

  async login(data: { email: string; password: string }) {
    const user = await this.userModel.findOne({ email: data.email.toLowerCase() });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(data.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = this.generateToken(user);
    return {
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        domain: user.domain,
        quotaMb: user.quotaMb,
        usedQuotaMb: user.usedQuotaMb,
      },
    };
  }

  private generateToken(user: UserDocument) {
    const payload = {
      sub: user._id,
      email: user.email,
      role: user.role,
      domain: user.domain,
    };
    return this.jwtService.sign(payload);
  }
}
