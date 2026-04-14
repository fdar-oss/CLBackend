import {
  Controller, Get, Post, Patch, Body, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new user' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    return this.usersService.create(user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all users in tenant' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.usersService.findAll(user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.usersService.findOne(user.tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update user' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(user.tenantId, id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Deactivate user' })
  deactivate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.usersService.deactivate(user.tenantId, id);
  }
}
