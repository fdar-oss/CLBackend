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

  // ─── Access Control (MUST be above :id routes) ──────────────────────────────

  @Get('access-control')
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Get all role permissions' })
  getAllPermissions(@CurrentUser() u: JwtPayload) {
    return this.usersService.getAllPermissions(u.tenantId);
  }

  @Get('access-control/my')
  @ApiOperation({ summary: 'Get current user permissions' })
  getMyPermissions(@CurrentUser() u: JwtPayload) {
    return this.usersService.getPermissions(u.tenantId, u.role as any);
  }

  @Patch('access-control/:role')
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Update permissions for a role' })
  updatePermissions(
    @CurrentUser() u: JwtPayload,
    @Param('role') role: string,
    @Body() body: { allowedRoutes: string[]; allowedFeatures: string[] },
  ) {
    return this.usersService.updatePermissions(u.tenantId, role as any, body.allowedRoutes, body.allowedFeatures);
  }

  // ─── User CRUD ──────────────────────────────────────────────────────────────

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
