import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
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

  @Get('stock-items/:id/check-delete')
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Check what data is linked before deleting' })
  checkDelete(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.inventoryService.checkStockItemDeletion(u.tenantId, id);
  }

  @Delete('stock-items/:id')
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Delete stock item (hard if no data, soft if linked)' })
  deleteStockItem(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.inventoryService.deleteStockItem(u.tenantId, id);
  }

  // ─── Stock Batches (FIFO) ─────────────────────────────────────────────────

  @Post('stock-items/:id/batches')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.INVENTORY_STAFF)
  @ApiOperation({ summary: 'Add a new batch/brand to a stock item' })
  addBatch(@Param('id') id: string, @Body() body: any) {
    return this.inventoryService.addBatch(id, body);
  }

  @Get('stock-items/:id/batches')
  @ApiOperation({ summary: 'Get all batches for a stock item' })
  getBatches(@Param('id') id: string) {
    return this.inventoryService.getBatches(id);
  }

  @Patch('batches/:id')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.INVENTORY_STAFF)
  @ApiOperation({ summary: 'Update a batch' })
  updateBatch(@Param('id') id: string, @Body() body: any) {
    return this.inventoryService.updateBatch(id, body);
  }

  @Delete('batches/:id')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  deleteBatch(@Param('id') id: string) {
    return this.inventoryService.deleteBatch(id);
  }

  // ─── Prep Recipes (house-made items) ──────────────────────────────────────

  @Post('prep-recipes/:stockItemId')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create/update production recipe for a house-made item' })
  upsertPrepRecipe(@Param('stockItemId') stockItemId: string, @Body() body: any) {
    return this.inventoryService.upsertPrepRecipe(stockItemId, body);
  }

  @Get('prep-recipes/:stockItemId')
  @ApiOperation({ summary: 'Get production recipe for a house-made item' })
  getPrepRecipe(@Param('stockItemId') stockItemId: string) {
    return this.inventoryService.getPrepRecipe(stockItemId);
  }

  @Post('prep-recipes/:stockItemId/produce')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.INVENTORY_STAFF)
  @ApiOperation({ summary: 'Make a batch — deducts raw ingredients, adds produced stock' })
  producePrep(@Param('stockItemId') stockItemId: string, @Body() body: { locationId: string; batches?: number }) {
    return this.inventoryService.producePrep(stockItemId, body.locationId, body.batches || 1);
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
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Create or update recipe (admin only)' })
  upsertRecipe(@Param('menuItemId') menuItemId: string, @Body() body: any) {
    return this.inventoryService.upsertRecipe(menuItemId, body);
  }

  @Get('recipes/:menuItemId')
  @ApiOperation({ summary: 'Get recipe (pass ?variantId= for variant-specific)' })
  getRecipe(@Param('menuItemId') menuItemId: string, @Query('variantId') variantId?: string) {
    return this.inventoryService.getRecipe(menuItemId, variantId);
  }

  @Get('recipes/:menuItemId/all')
  @ApiOperation({ summary: 'Get all recipes for a menu item (base + per-variant)' })
  getRecipesForItem(@Param('menuItemId') menuItemId: string) {
    return this.inventoryService.getRecipesForItem(menuItemId);
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

  // ─── Cost Analysis ──────────────────────────────────────────────────────────

  @Get('cost-analysis')
  @ApiOperation({ summary: 'Get cost analysis for all menu items' })
  getCostAnalysis(@CurrentUser() u: JwtPayload) {
    return this.inventoryService.getCostAnalysis(u.tenantId);
  }

  // ─── Packaging Rules ────────────────────────────────────────────────────────

  @Get('packaging-rules')
  @ApiOperation({ summary: 'List packaging rules' })
  getPackagingRules(@CurrentUser() u: JwtPayload) {
    return this.inventoryService.getPackagingRules(u.tenantId);
  }

  @Post('packaging-rules')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a packaging rule' })
  createPackagingRule(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.inventoryService.createPackagingRule(u.tenantId, body);
  }

  @Delete('packaging-rules/:id')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a packaging rule' })
  deletePackagingRule(@Param('id') id: string) {
    return this.inventoryService.deletePackagingRule(id);
  }
}
