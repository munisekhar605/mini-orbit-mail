import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { MailboxesService } from './mailboxes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateMailboxDto } from './dto/create-mailbox.dto';
import { UpdateMailboxDto } from './dto/update-mailbox.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/mailboxes')
export class MailboxesController {
  constructor(private readonly mailboxesService: MailboxesService) {}

  @Get()
  findAll(@Query('domain') domain?: string) {
    return this.mailboxesService.findAll(domain);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mailboxesService.findOne(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() createMailboxDto: CreateMailboxDto) {
    return this.mailboxesService.create(createMailboxDto);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() updateMailboxDto: UpdateMailboxDto) {
    return this.mailboxesService.update(id, updateMailboxDto);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) {
    return this.mailboxesService.delete(id);
  }
}
