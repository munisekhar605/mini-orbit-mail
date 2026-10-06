import { IsNotEmpty, IsString, Matches, IsOptional, IsNumber, Min } from 'class-validator';

export class CreateDomainDto {
  @IsNotEmpty({ message: 'Domain name is required' })
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/, {
    message: 'Domain name must be a valid FQDN (e.g. example.com)',
  })
  name: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUsers?: number;

  @IsOptional()
  @IsNumber()
  @Min(1024)
  maxQuotaMb?: number;
}
