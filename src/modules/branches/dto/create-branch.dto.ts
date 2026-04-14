import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsInt, Min } from 'class-validator';

export class CreateBranchDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty({ description: 'Short code e.g. ISB-01' }) @IsString() @IsNotEmpty() code: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() ntn?: string;
  @IsOptional() @IsString() strn?: string;
  @IsOptional() @IsString() openingTime?: string;
  @IsOptional() @IsString() closingTime?: string;
  @IsOptional() @IsInt() @Min(1) seatingCapacity?: number;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() openingTime?: string;
  @IsOptional() @IsString() closingTime?: string;
  @IsOptional() @IsInt() seatingCapacity?: number;
}
