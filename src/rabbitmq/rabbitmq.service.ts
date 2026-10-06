import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqp-connection-manager';
import { ChannelWrapper } from 'amqp-connection-manager';
import { Channel, ConsumeMessage } from 'amqplib';

export interface EmailJobPayload {
  messageId: string;
  senderEmail: string;
  to: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  retryCount?: number;
}

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: amqp.AmqpConnectionManager;
  private channelWrapper: ChannelWrapper;

  public static readonly QUEUE_NAME = 'email_delivery_queue';
  public static readonly DLQ_NAME = 'email_dead_letter_queue';
  public static readonly EXCHANGE_NAME = 'email_exchange';
  public static readonly DLX_NAME = 'email_dead_letter_exchange';
  public static readonly ROUTING_KEY = 'email.send';

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const rabbitMqUrl =
      this.configService.get<string>('RABBITMQ_URL') ||
      'amqp://guest:guest@127.0.0.1:5672';

    this.logger.log(`Connecting to RabbitMQ at ${rabbitMqUrl}...`);

    try {
      this.connection = amqp.connect([rabbitMqUrl], {
        reconnectTimeInSeconds: 5,
        heartbeatIntervalInSeconds: 10,
      });

      this.connection.on('connect', () => {
        this.logger.log('Connected to RabbitMQ cluster successfully');
      });

      this.connection.on('disconnect', (err) => {
        this.logger.warn(`Disconnected from RabbitMQ: ${err?.err?.message || 'reconnecting...'}`);
      });

      this.channelWrapper = this.connection.createChannel({
        json: true,
      });
    } catch (err: any) {
      this.logger.error(`RabbitMQ initialization error: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    await this.channelWrapper?.close();
    await this.connection?.close();
  }

  // Publish email job to RabbitMQ queue
  async publishEmailJob(job: EmailJobPayload): Promise<boolean> {
    try {
      await this.channelWrapper.sendToQueue(
        RabbitMQService.QUEUE_NAME,
        job,
        {
          persistent: true,
          headers: {
            'x-retry-count': job.retryCount || 0,
          },
        },
      );
      this.logger.log(`Email job [${job.messageId}] pushed to RabbitMQ (${job.to})`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to publish email job to RabbitMQ: ${err.message}`);
      return false;
    }
  }

  // Register background consumer to process queued emails
  async consumeEmailJobs(processor: (job: EmailJobPayload) => Promise<void>) {
    if (!this.channelWrapper) return;

    await this.channelWrapper.addSetup(async (channel: Channel) => {
      // 1. Assert Dead Letter Exchange & Queue first
      await channel.assertExchange(RabbitMQService.DLX_NAME, 'direct', { durable: true });
      await channel.assertQueue(RabbitMQService.DLQ_NAME, { durable: true });
      await channel.bindQueue(RabbitMQService.DLQ_NAME, RabbitMQService.DLX_NAME, RabbitMQService.ROUTING_KEY);

      // 2. Assert Primary Exchange & Queue with Dead Letter routing
      await channel.assertExchange(RabbitMQService.EXCHANGE_NAME, 'direct', { durable: true });
      await channel.assertQueue(RabbitMQService.QUEUE_NAME, {
        durable: true,
        deadLetterExchange: RabbitMQService.DLX_NAME,
        deadLetterRoutingKey: RabbitMQService.ROUTING_KEY,
      });
      await channel.bindQueue(
        RabbitMQService.QUEUE_NAME,
        RabbitMQService.EXCHANGE_NAME,
        RabbitMQService.ROUTING_KEY,
      );

      await channel.prefetch(10);
      this.logger.log(`RabbitMQ queues asserted: ${RabbitMQService.QUEUE_NAME} is ready`);

      // 3. Now consume safely after queue is verified to exist on broker
      await channel.consume(
        RabbitMQService.QUEUE_NAME,
        async (msg: ConsumeMessage | null) => {
          if (!msg) return;

          let payload: EmailJobPayload;
          try {
            payload = JSON.parse(msg.content.toString());
          } catch {
            channel.ack(msg);
            return;
          }

          try {
            await processor(payload);
            channel.ack(msg);
          } catch (err: any) {
            const currentRetries = (msg.properties.headers?.['x-retry-count'] || 0) as number;
            this.logger.warn(
              `Job [${payload.messageId}] failed (Attempt ${currentRetries + 1}): ${err.message}`,
            );

            if (currentRetries < 3) {
              channel.ack(msg);
              setTimeout(async () => {
                await this.publishEmailJob({
                  ...payload,
                  retryCount: currentRetries + 1,
                });
              }, (currentRetries + 1) * 5000);
            } else {
              this.logger.error(`Job [${payload.messageId}] exceeded max retries. Moving to DLQ.`);
              channel.nack(msg, false, false);
            }
          }
        },
        { noAck: false },
      );
    });
  }
}
