import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { Domain, DomainSchema } from '../schemas/domain.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { EmailMessage, EmailMessageSchema } from '../schemas/email-message.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Domain.name, schema: DomainSchema },
      { name: User.name, schema: UserSchema },
      { name: EmailMessage.name, schema: EmailMessageSchema },
    ]),
  ],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
