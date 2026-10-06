import { IsEmail, IsNotEmpty, MinLength, IsOptional, IsNumber, Min, IsString } from 'class-validator';

export class CreateMailboxDto {
  @IsEmail({}, { message: 'Must be a valid email address (e.g. john@domain.com)' })
  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password: string;

  @IsOptional()
  @IsNumber()
  @Min(100)
  quotaMb?: number;

  @IsOptional()
  @IsString()
  role?: string;
}
