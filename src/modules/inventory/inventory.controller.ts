import {
  Controller, Get, Post, Patch, Body, Param, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  @Post('stock-items')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.INVENTORY_STAFF)
  createStockItem(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.inventoryService.createStockItem(u.tenantId, body);
  }

  @Get('stock-items')
  getStockItems(@CurrentUser() u: JwtPayload) {
    return this.inventoryService.getStockItems(u.tenantId);
  }

  @Patch('stock-items/:id')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.INVENTORY_STAFF)
  updateStockItem(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.inventoryService.updateStockItem(u.tenantId, id, body);
  }

  @Get('balances')
  @ApiOperation({ summary: 'Current stock levels by location' })
  getBalances(@CurrentUser() u: JwtPayload, @Query('locationId') locationId?: string) {
    return this.inventoryService.getBalances(u.tenantId, locationId);
  }

  @Get('alerts/low-stock')
  @ApiOperation({ summary: 'Items below minimum stock level' })
  getLowStockAlerts(@CurrentUser() u: JwtPayload) {
    return this.inventoryService.getLowStockAlerts(u.tenantId);
  }

  @Post('movements')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.INVENTORY_STAFF)
  @ApiOperation({ summary: 'Record manual stock movement (wastage, transfer, adjustment)' })
  recordMovement(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.inventoryService.recordMovement({ ...body, performedById: u.sub });
  }

  @Get('movements')
  getMovements(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.inventoryService.getMovements(u.tenantId, filters);
  }

  @Post('recipes/:menuItemId')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create or update recipe for a menu item' })
  upsertRecipe(@Param('menuItemId') menuItemId: string, @Body() body: any) {
    return this.inventoryService.upsertRecipe(menuItemId, body);
  }

  @Get('recipes/:menuItemId')
  getRecipe(@Param('menuItemId') menuItemId: string) {
    return this.inventoryService.getRecipe(menuItemId);
  }

  @Post('stock-count')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.INVENTORY_STAFF)
  @ApiOperation({ summary: 'Submit physical stock count and auto-adjust variances' })
  submitStockCount(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.inventoryService.submitStockCount(
      u.tenantId, body.locationId, body.counts, u.sub,
    );
  }

  @Get('categories')
  getCategories(@CurrentUser() u: JwtPayload) {
    return this.inventoryService.getStockCategories(u.tenantId);
  }

  @Post('categories')
  createCategory(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.inventoryService.createStockCategory(u.tenantId, body);
  }

  @Get('locations/:branchId')
  getLocations(@Param('branchId') branchId: string) {
    return this.inventoryService.getLocations(branchId);
  }

  @Post('locations')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a stock location for a branch (e.g. Bar, Cold Room)' })
  createLocation(@Body() body: any) {
    return this.inventoryService.createLocation(body.branchId, body);
  }
}
