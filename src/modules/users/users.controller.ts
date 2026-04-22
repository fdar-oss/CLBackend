import {
  Controller, Get, Post, Patch, Body, Param, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { AuditService } from '../../common/services/audit.service';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService, private auditService: AuditService) {}

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
  @ApiOperation({ summary: 'Get all user permissions' })
  getAllPermissions(@CurrentUser() u: JwtPayload) {
    return this.usersService.getAllUserPermissions(u.tenantId);
  }

  @Get('access-control/my')
  @ApiOperation({ summary: 'Get current user permissions' })
  getMyPermissions(@CurrentUser() u: JwtPayload) {
    return this.usersService.getUserPermissions(u.sub);
  }

  @Patch('access-control/user/:userId')
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Update permissions for a specific user' })
  updateUserPermissions(
    @Param('userId') userId: string,
    @Body() body: { allowedRoutes: string[]; allowedFeatures: string[] },
  ) {
    return this.usersService.updateUserPermissions(userId, body.allowedRoutes, body.allowedFeatures);
  }

  // ─── Activity Log ───────────────────────────────────────────────────────────

  @Get('activity-log')
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Get audit/activity log' })
  getActivityLog(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.auditService.getLogs(u.tenantId, filters);
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
