import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class InboundEmailDto {
  @IsEmail()
  @IsNotEmpty()
  from: string;

  @IsEmail()
  @IsNotEmpty()
  to: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  text?: string;

  @IsString()
  @IsOptional()
  html?: string;
}
