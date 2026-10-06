import { IsOptional, IsNumber, Min, IsString, MinLength, IsBoolean } from 'class-validator';

export class UpdateMailboxDto {
  @IsOptional()
  @IsNumber()
  @Min(100)
  quotaMb?: number;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
