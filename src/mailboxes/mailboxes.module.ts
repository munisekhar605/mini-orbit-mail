import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailboxesService } from './mailboxes.service';
import { MailboxesController } from './mailboxes.controller';
import { User, UserSchema } from '../schemas/user.schema';
import { Domain, DomainSchema } from '../schemas/domain.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Domain.name, schema: DomainSchema },
    ]),
  ],
  controllers: [MailboxesController],
  providers: [MailboxesService],
  exports: [MailboxesService],
})
export class MailboxesModule {}
