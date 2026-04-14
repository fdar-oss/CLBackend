import {
  Controller, Get, Post, Patch, Body, Param,
  Query, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/create-tenant.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  // Public signup endpoint (new restaurant registration)
  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new tenant (restaurant signup)' })
  register(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all tenants (platform admin)' })
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.tenantsService.findAll(page, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tenant by ID' })
  findOne(@Param('id') id: string) {
    return this.tenantsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update tenant settings' })
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Patch(':id/suspend')
  @ApiOperation({ summary: 'Suspend a tenant' })
  suspend(@Param('id') id: string) {
    return this.tenantsService.suspend(id);
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Activate a suspended tenant' })
  activate(@Param('id') id: string) {
    return this.tenantsService.activate(id);
  }
}
