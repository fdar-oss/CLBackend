import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/create-branch.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private branchesService: BranchesService) {}

  @Post()
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Create new branch' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBranchDto) {
    return this.branchesService.create(user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all branches' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.branchesService.findAll(user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get branch detail' })
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.branchesService.findOne(user.tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update branch' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.update(user.tenantId, id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Deactivate a branch' })
  deactivate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.branchesService.deactivate(user.tenantId, id);
  }
}
