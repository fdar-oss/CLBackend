import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Menu')
@ApiBearerAuth()
@Controller('menu')
export class MenuController {
  constructor(private menuService: MenuService) {}

  // ─── Categories ─────────────────────────────────────────────────────────────

  @Post('categories')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  createCategory(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.menuService.createCategory(u.tenantId, body);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get all menu categories' })
  getCategories(@CurrentUser() u: JwtPayload) {
    return this.menuService.getCategories(u.tenantId);
  }

  @Patch('categories/:id')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  updateCategory(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.menuService.updateCategory(u.tenantId, id, body);
  }

  @Delete('categories/:id')
  @Roles(UserRole.TENANT_OWNER)
  deleteCategory(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.menuService.deleteCategory(u.tenantId, id);
  }

  // ─── Items ──────────────────────────────────────────────────────────────────

  @Post('items')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  createItem(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.menuService.createItem(u.tenantId, body);
  }

  @Get('items')
  @ApiOperation({ summary: 'Get menu items (optionally filter by category or branch)' })
  getItems(
    @CurrentUser() u: JwtPayload,
    @Query('categoryId') categoryId?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.menuService.getItems(u.tenantId, categoryId, branchId);
  }

  @Get('items/:id')
  getItem(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.menuService.getItem(u.tenantId, id);
  }

  @Patch('items/:id')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  updateItem(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.menuService.updateItem(u.tenantId, id, body);
  }

  @Patch('items/:id/toggle')
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Toggle item active/inactive (admin only)' })
  toggleItem(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.menuService.toggleItem(u.tenantId, id);
  }

  @Delete('items/:id')
  @Roles(UserRole.TENANT_OWNER)
  @ApiOperation({ summary: 'Permanently delete a menu item (admin only)' })
  deleteItem(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.menuService.deleteItem(u.tenantId, id);
  }

  // ─── Variants ───────────────────────────────────────────────────────────────

  @Post('items/:id/variants')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Add a variant to a menu item' })
  createVariant(@Param('id') id: string, @Body() body: any) {
    return this.menuService.createVariant(id, body);
  }

  @Patch('variants/:variantId')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a variant' })
  updateVariant(@Param('variantId') variantId: string, @Body() body: any) {
    return this.menuService.updateVariant(variantId, body);
  }

  @Delete('variants/:variantId')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a variant' })
  deleteVariant(@Param('variantId') variantId: string) {
    return this.menuService.deleteVariant(variantId);
  }

  @Post('items/:id/variants/bulk')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Set all variants for an item (replaces existing)' })
  setVariants(@Param('id') id: string, @Body() body: { variants: any[] }) {
    return this.menuService.setVariants(id, body.variants);
  }

  // ─── Modifiers ──────────────────────────────────────────────────────────────

  @Post('modifier-groups')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  createModifierGroup(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.menuService.createModifierGroup(u.tenantId, body);
  }

  @Get('modifier-groups')
  getModifierGroups(@CurrentUser() u: JwtPayload) {
    return this.menuService.getModifierGroups(u.tenantId);
  }

  // ─── Tax ────────────────────────────────────────────────────────────────────

  @Get('tax-categories')
  getTaxCategories(@CurrentUser() u: JwtPayload) {
    return this.menuService.getTaxCategories(u.tenantId);
  }

  @Post('tax-categories')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  createTaxCategory(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.menuService.createTaxCategory(u.tenantId, body);
  }

  // ─── Branch Prices ──────────────────────────────────────────────────────────

  @Patch('items/:itemId/branch-price/:branchId')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Set branch-specific price and availability for a menu item' })
  setBranchPrice(
    @Param('itemId') itemId: string,
    @Param('branchId') branchId: string,
    @Body() body: { price: number; isAvailable?: boolean },
  ) {
    return this.menuService.setBranchPrice(itemId, branchId, body.price, body.isAvailable);
  }

  // ─── Image Upload ────────────────────────────────────────────────────────────

  @Post('upload-image')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Upload a menu item image, returns { url }' })
  @UseInterceptors(FileInterceptor('image', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dest = join(process.cwd(), 'uploads', 'menu');
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
        cb(null, dest);
      },
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        cb(null, `${unique}${extname(file.originalname)}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
        return cb(new BadRequestException('Only image files are allowed (jpg, png, webp, gif)'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return { url: `/uploads/menu/${file.filename}` };
  }

  // ─── POS Menu (optimized full menu for POS terminal) ─────────────────────────

  @Get('pos/:branchId')
  @ApiOperation({ summary: 'Get complete menu optimized for POS terminal' })
  getPosMenu(@CurrentUser() u: JwtPayload, @Param('branchId') branchId: string) {
    return this.menuService.getPosMenu(u.tenantId, branchId);
  }
}
