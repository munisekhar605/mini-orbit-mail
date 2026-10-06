import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WebmailService } from './webmail.service';
import { WebmailController } from './webmail.controller';
import { EmailMessage, EmailMessageSchema } from '../schemas/email-message.schema';
import { Domain, DomainSchema } from '../schemas/domain.schema';
import { User, UserSchema } from '../schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailMessage.name, schema: EmailMessageSchema },
      { name: Domain.name, schema: DomainSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [WebmailController],
  providers: [WebmailService],
  exports: [WebmailService],
})
export class WebmailModule {}
