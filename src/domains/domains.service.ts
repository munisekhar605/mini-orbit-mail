import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import * as dns from 'dns/promises';
import { Domain, DomainDocument } from '../schemas/domain.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { generateDomainSecurityRecords } from '../common/utils/dns-crypto.util';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class DomainsService {
  constructor(
    @InjectModel(Domain.name) private domainModel: Model<DomainDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private configService: ConfigService,
    private redisService: RedisService,
  ) {}

  async findAll() {
    const domains = await this.domainModel.find().sort({ createdAt: -1 });
    const result = await Promise.all(
      domains.map(async (domain) => {
        const userCount = await this.userModel.countDocuments({ domain: domain.name });
        return {
          ...domain.toObject(),
          userCount,
        };
      }),
    );
    return result;
  }

  async findOne(id: string) {
    const domain = await this.domainModel.findById(id);
    if (!domain) {
      throw new NotFoundException('Domain not found');
    }
    const userCount = await this.userModel.countDocuments({ domain: domain.name });
    return {
      ...domain.toObject(),
      userCount,
      dnsGuide: {
        mx: { type: 'MX', host: '@', priority: 10, value: `mail.${domain.name}` },
        spf: { type: 'TXT', host: '@', value: domain.spfRecord },
        dkim: { type: 'TXT', host: `${domain.dkimSelector}._domainkey`, value: domain.dkimPublicKey },
        dmarc: { type: 'TXT', host: '_dmarc', value: domain.dmarcRecord },
      },
    };
  }

  async create(data: { name: string; maxUsers?: number; maxQuotaMb?: number }) {
    const cleanName = data.name.trim().toLowerCase();
    const existing = await this.domainModel.findOne({ name: cleanName });
    if (existing) {
      throw new BadRequestException(`Domain "${cleanName}" already exists`);
    }

    // Cryptographically generate unique 2048-bit RSA keys and authentic DNS records
    const serverIp = this.configService.get<string>('SERVER_IP');
    const sec = generateDomainSecurityRecords(cleanName, serverIp);

    const domain = await this.domainModel.create({
      name: cleanName,
      maxUsers: data.maxUsers || 50,
      maxQuotaMb: data.maxQuotaMb || 50000,
      status: 'pending',
      dkimSelector: sec.dkimSelector,
      dkimPublicKey: sec.dkimPublicKey,
      dkimPrivateKey: sec.dkimPrivateKey,
      spfRecord: sec.spfRecord,
      dmarcRecord: sec.dmarcRecord,
      isActive: true,
    });

    return domain;
  }

  // Live DNS Verification Engine with Redis caching
  async verifyDns(id: string) {
    const domain = await this.domainModel.findById(id);
    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    const domainName = domain.name;
    const checks: any = {
      mx: { status: 'missing', found: [] },
      spf: { status: 'missing', found: null },
      dkim: { status: 'missing', found: null },
      dmarc: { status: 'missing', found: null },
    };

    // 1. Resolve and verify MX records
    try {
      const mxRecords = await dns.resolveMx(domainName);
      checks.mx.found = mxRecords;
      checks.mx.status = mxRecords && mxRecords.length > 0 ? 'verified' : 'missing';
    } catch {
      checks.mx.status = 'missing';
    }

    // 2. Resolve and verify SPF record
    try {
      const txtRecords = await dns.resolveTxt(domainName);
      const flattened = txtRecords.map((chunk) => chunk.join(''));
      const spf = flattened.find((r) => r.startsWith('v=spf1'));
      if (spf) {
        checks.spf.status = 'verified';
        checks.spf.found = spf;
      }
    } catch {
      checks.spf.status = 'missing';
    }

    // 3. Resolve and verify DKIM record
    try {
      const dkimHost = `${domain.dkimSelector || 'default'}._domainkey.${domainName}`;
      const dkimTxt = await dns.resolveTxt(dkimHost);
      const flattenedDkim = dkimTxt.map((chunk) => chunk.join(''));
      const dkim = flattenedDkim.find((r) => r.startsWith('v=DKIM1'));
      if (dkim) {
        checks.dkim.status = 'verified';
        checks.dkim.found = dkim;
      }
    } catch {
      checks.dkim.status = 'missing';
    }

    // 4. Resolve and verify DMARC record
    try {
      const dmarcHost = `_dmarc.${domainName}`;
      const dmarcTxt = await dns.resolveTxt(dmarcHost);
      const flattenedDmarc = dmarcTxt.map((chunk) => chunk.join(''));
      const dmarc = flattenedDmarc.find((r) => r.startsWith('v=DMARC1'));
      if (dmarc) {
        checks.dmarc.status = 'verified';
        checks.dmarc.found = dmarc;
      }
    } catch {
      checks.dmarc.status = 'missing';
    }

    const isFullyVerified =
      checks.mx.status === 'verified' &&
      checks.spf.status === 'verified' &&
      checks.dkim.status === 'verified' &&
      checks.dmarc.status === 'verified';

    domain.status = isFullyVerified ? 'active' : 'pending';
    await domain.save();

    // Cache verification outcome in Redis for fast lookup
    await this.redisService.set(
      `domain:dns:${domainName}`,
      JSON.stringify({ status: domain.status, isFullyVerified, verifiedAt: new Date() }),
      300, // 5 min cache
    );

    return {
      domain: domainName,
      status: domain.status,
      isFullyVerified,
      checks,
    };
  }

  async delete(id: string) {
    const domain = await this.domainModel.findById(id);
    if (!domain) {
      throw new NotFoundException('Domain not found');
    }
    await this.userModel.deleteMany({ domain: domain.name });
    await this.domainModel.findByIdAndDelete(id);

    // Invalidate Redis cache
    await this.redisService.del(`domain:dns:${domain.name}`);

    return { message: `Domain "${domain.name}" and associated mailboxes deleted` };
  }
}
