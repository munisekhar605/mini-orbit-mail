import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST') || '127.0.0.1';
    const port = Number(this.configService.get<number>('REDIS_PORT')) || 6379;
    const password = this.configService.get<string>('REDIS_PASSWORD') || undefined;

    this.client = new Redis({
      host,
      port,
      password,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.connect().then(() => {
      this.logger.log(`Connected to Redis at ${host}:${port} successfully`);
    }).catch((err) => {
      this.logger.warn(`Redis connection deferred: ${err.message}`);
    });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis client error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  // Basic Cache Operations
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to set Redis key ${key}: ${err.message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err: any) {
      this.logger.warn(`Failed to delete Redis key ${key}: ${err.message}`);
    }
  }

  // High-Speed Rate Limiting (Used to prevent outbound spam attacks)
  async incrementWithLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }> {
    try {
      const current = await this.client.incr(key);
      if (current === 1) {
        await this.client.expire(key, windowSeconds);
      }
      return {
        allowed: current <= limit,
        remaining: Math.max(0, limit - current),
      };
    } catch {
      // Fail-open if Redis is unreachable
      return { allowed: true, remaining: limit };
    }
  }

  // Token Blacklist (Instant JWT Revocation on Logout)
  async blacklistToken(token: string, expiresInSeconds: number): Promise<void> {
    await this.set(`blacklist:jwt:${token}`, 'revoked', expiresInSeconds);
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const status = await this.get(`blacklist:jwt:${token}`);
    return status === 'revoked';
  }
}
