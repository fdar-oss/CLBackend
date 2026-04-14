import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail, IsEnum, IsNotEmpty, IsOptional,
  IsString, MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @IsNotEmpty() fullName: string;
  @ApiProperty() @IsString() @MinLength(8) password: string;
  @ApiProperty({ enum: UserRole }) @IsEnum(UserRole) role: UserRole;
  @ApiProperty({ required: false }) @IsOptional() @IsString() phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() branchId?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() avatar?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsString() branchId?: string;
}
