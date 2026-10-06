import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { WebmailService } from './webmail.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SendEmailDto } from './dto/send-email.dto';
import { InboundEmailDto } from './dto/inbound-email.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/webmail')
export class WebmailController {
  constructor(private readonly webmailService: WebmailService) {}

  @UseGuards(JwtAuthGuard)
  @Get('messages')
  getMessages(@CurrentUser() user: any, @Query('folder') folder?: string) {
    return this.webmailService.getMessages(user.email, folder);
  }

  @UseGuards(JwtAuthGuard)
  @Get('messages/:id')
  getMessage(@CurrentUser() user: any, @Param('id') id: string) {
    return this.webmailService.getMessage(id, user.email);
  }

  @UseGuards(JwtAuthGuard)
  @Post('send')
  send(@CurrentUser() user: any, @Body() sendEmailDto: SendEmailDto) {
    return this.webmailService.sendMessage(user.email, sendEmailDto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('messages/:id/star')
  toggleStar(@CurrentUser() user: any, @Param('id') id: string) {
    return this.webmailService.toggleStar(id, user.email);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('messages/:id')
  moveToTrash(@CurrentUser() user: any, @Param('id') id: string) {
    return this.webmailService.moveToTrash(id, user.email);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('messages/:id/folder')
  moveToFolder(@CurrentUser() user: any, @Param('id') id: string, @Body('folder') folder: string) {
    return this.webmailService.moveToFolder(id, user.email, folder);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('messages/:id/read')
  toggleRead(@CurrentUser() user: any, @Param('id') id: string, @Body('isRead') isRead?: boolean) {
    return this.webmailService.toggleRead(id, user.email, isRead);
  }

  // Public webhook for inbound external emails from mail daemon (Postfix, Exim, Haraka, or cloud relays)
  @Post('inbound')
  receiveInbound(@Body() inboundDto: InboundEmailDto) {
    return this.webmailService.handleInboundEmail({
      from: inboundDto.from,
      to: inboundDto.to,
      subject: inboundDto.subject || '',
      text: inboundDto.text || '',
      html: inboundDto.html,
    });
  }
}
