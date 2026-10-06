import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class SendEmailDto {
  @IsEmail({}, { message: 'Recipient must be a valid email address' })
  @IsNotEmpty({ message: 'Recipient email is required' })
  to: string;

  @IsNotEmpty({ message: 'Email subject is required' })
  @IsString()
  subject: string;

  @IsNotEmpty({ message: 'Email body is required' })
  @IsString()
  body: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;
}
