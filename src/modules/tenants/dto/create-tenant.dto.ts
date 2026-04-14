import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString,
  Matches, MinLength,
} from 'class-validator';
import { PlanType } from '@prisma/client';

export class CreateTenantDto {
  @ApiProperty({ example: 'The Coffee Lab' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'thecoffeelab', description: 'URL-safe slug' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase letters, numbers and hyphens only' })
  slug: string;

  @ApiProperty({ example: 'owner@thecoffeelab.pk' })
  @IsEmail()
  ownerEmail: string;

  @ApiProperty({ example: 'Ahmad Khan' })
  @IsString()
  @IsNotEmpty()
  ownerName: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  ownerPassword: string;

  @ApiProperty({ example: '+923001234567', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ enum: PlanType, default: PlanType.STARTER })
  @IsOptional()
  @IsEnum(PlanType)
  plan?: PlanType;
}

export class UpdateTenantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() logo?: string;
  @IsOptional() @IsString() primaryColor?: string;
  @IsOptional() @IsString() accentColor?: string;
  @IsOptional() @IsString() ntn?: string;
  @IsOptional() @IsString() strn?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() website?: string;
}
