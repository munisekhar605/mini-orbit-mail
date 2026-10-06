import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { DomainsService } from './domains.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateDomainDto } from './dto/create-domain.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/domains')
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  @Get()
  findAll() {
    return this.domainsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.domainsService.findOne(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() createDomainDto: CreateDomainDto) {
    return this.domainsService.create(createDomainDto);
  }

  @Post(':id/verify-dns')
  @Roles('admin')
  verifyDns(@Param('id') id: string) {
    return this.domainsService.verifyDns(id);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) {
    return this.domainsService.delete(id);
  }
}
