import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MenuService {
  constructor(private prisma: PrismaService) {}

  // ─── Categories ─────────────────────────────────────────────────────────────

  async createCategory(tenantId: string, data: any) {
    return this.prisma.menuCategory.create({ data: { tenantId, ...data } });
  }

  async getCategories(tenantId: string) {
    return this.prisma.menuCategory.findMany({
      where: { tenantId, isActive: true },
      include: { _count: { select: { menuItems: true } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async updateCategory(tenantId: string, id: string, data: any) {
    const cat = await this.prisma.menuCategory.findFirst({ where: { id, tenantId } });
    if (!cat) throw new NotFoundException('Category not found');
    return this.prisma.menuCategory.update({ where: { id }, data });
  }

  async deleteCategory(tenantId: string, id: string) {
    const cat = await this.prisma.menuCategory.findFirst({ where: { id, tenantId } });
    if (!cat) throw new NotFoundException('Category not found');

    const itemCount = await this.prisma.menuItem.count({ where: { categoryId: id } });
    if (itemCount > 0) {
      await this.prisma.menuCategory.update({ where: { id }, data: { isActive: false } });
      return { deleted: false, deactivated: true, reason: `Category has ${itemCount} items — deactivated instead` };
    }

    await this.prisma.menuCategory.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Items ──────────────────────────────────────────────────────────────────

  async createItem(tenantId: string, data: any) {
    const { modifierGroupIds, ...itemData } = data;
    return this.prisma.menuItem.create({
      data: {
        tenantId,
        ...itemData,
        ...(modifierGroupIds?.length && {
          modifierGroups: {
            create: modifierGroupIds.map((id: string, i: number) => ({
              modifierGroupId: id,
              sortOrder: i,
            })),
          },
        }),
      },
      include: {
        category: true,
        taxCategory: true,
        variants: { orderBy: { sortOrder: 'asc' } },
        modifierGroups: { include: { modifierGroup: { include: { modifiers: true } } } },
        recipes: { include: { ingredients: { include: { stockItem: true } } } },
      },
    });
  }

  async getItems(tenantId: string, categoryId?: string, branchId?: string) {
    const items = await this.prisma.menuItem.findMany({
      where: { tenantId, isActive: true, ...(categoryId && { categoryId }) },
      include: {
        category: { select: { id: true, name: true } },
        taxCategory: { select: { id: true, name: true, rate: true } },
        variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        modifierGroups: {
          orderBy: { sortOrder: 'asc' },
          include: {
            modifierGroup: {
              include: { modifiers: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
            },
          },
        },
        branchPrices: branchId ? { where: { branchId } } : false,
      },
      orderBy: { sortOrder: 'asc' },
    });

    // Apply branch-specific price if available
    if (branchId) {
      return items.map((item) => {
        const branchPrice = item.branchPrices?.find(bp => bp.branchId === branchId);
        return {
          ...item,
          effectivePrice: branchPrice?.price ?? item.basePrice,
          isAvailable: branchPrice?.isAvailable ?? true,
        };
      });
    }

    return items;
  }

  async getItem(tenantId: string, id: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, tenantId },
      include: {
        category: true,
        taxCategory: true,
        variants: { orderBy: { sortOrder: 'asc' } },
        modifierGroups: {
          include: { modifierGroup: { include: { modifiers: true } } },
        },
        recipes: { include: { ingredients: { include: { stockItem: true } } } },
        branchPrices: true,
      },
    });
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async updateItem(tenantId: string, id: string, data: any) {
    await this.getItem(tenantId, id);
    const {
      modifierGroupIds,
      branchPrices, effectivePrice,
      category, taxCategory, modifierGroups, recipe,
      id: _id, tenantId: _t, createdAt, updatedAt,
      categoryId, taxCategoryId,
      ...itemData
    } = data;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.menuItem.update({
        where: { id },
        data: {
          ...itemData,
          ...(categoryId !== undefined && { categoryId: categoryId || null }),
          ...(taxCategoryId !== undefined && { taxCategoryId: taxCategoryId || null }),
        },
      });

      // Replace linked modifier groups if explicitly provided (array, even if empty)
      if (Array.isArray(modifierGroupIds)) {
        await tx.menuItemModifierGroup.deleteMany({ where: { menuItemId: id } });
        if (modifierGroupIds.length > 0) {
          await tx.menuItemModifierGroup.createMany({
            data: modifierGroupIds.map((mgId: string, i: number) => ({
              menuItemId: id,
              modifierGroupId: mgId,
              sortOrder: i,
            })),
          });
        }
      }

      return updated;
    });
  }

  async toggleItem(tenantId: string, id: string) {
    const item = await this.getItem(tenantId, id);
    return this.prisma.menuItem.update({
      where: { id },
      data: { isActive: !item.isActive },
    });
  }

  async deleteItem(tenantId: string, id: string) {
    await this.getItem(tenantId, id);

    // Check if the item has any order history
    const orderCount = await this.prisma.posOrderItem.count({ where: { menuItemId: id } });

    if (orderCount > 0) {
      // Item has sales history — can't hard-delete, soft-delete instead
      await this.prisma.menuItem.update({ where: { id }, data: { isActive: false } });
      return { deleted: false, deactivated: true, reason: 'Item has order history — deactivated instead of deleted' };
    }

    // No order history — safe to permanently remove
    await this.prisma.$transaction(async (tx) => {
      await tx.menuItemModifierGroup.deleteMany({ where: { menuItemId: id } });
      await tx.branchMenuPrice.deleteMany({ where: { menuItemId: id } });
      const recipeIds = (await tx.recipe.findMany({ where: { menuItemId: id }, select: { id: true } })).map(r => r.id);
      if (recipeIds.length) await tx.recipeIngredient.deleteMany({ where: { recipeId: { in: recipeIds } } });
      await tx.recipe.deleteMany({ where: { menuItemId: id } });
      await tx.menuItemVariant.deleteMany({ where: { menuItemId: id } });
      await tx.menuItem.delete({ where: { id } });
    });
    return { deleted: true };
  }

  // ─── Variants ───────────────────────────────────────────────────────────────

  async createVariant(menuItemId: string, data: any) {
    return this.prisma.menuItemVariant.create({
      data: { menuItemId, ...data },
    });
  }

  async updateVariant(variantId: string, data: any) {
    return this.prisma.menuItemVariant.update({
      where: { id: variantId },
      data,
    });
  }

  async deleteVariant(variantId: string) {
    // Delete variant's recipe first
    await this.prisma.recipe.deleteMany({ where: { variantId } });
    await this.prisma.menuItemVariant.delete({ where: { id: variantId } });
    return { deleted: true };
  }

  async setVariants(menuItemId: string, variants: any[]) {
    // Replace all variants for this item
    await this.prisma.$transaction(async (tx) => {
      // Delete old variant recipes
      const oldVariants = await tx.menuItemVariant.findMany({ where: { menuItemId }, select: { id: true } });
      const oldIds = oldVariants.map(v => v.id);
      if (oldIds.length) {
        const recipeIds = (await tx.recipe.findMany({ where: { variantId: { in: oldIds } }, select: { id: true } })).map(r => r.id);
        if (recipeIds.length) await tx.recipeIngredient.deleteMany({ where: { recipeId: { in: recipeIds } } });
        await tx.recipe.deleteMany({ where: { variantId: { in: oldIds } } });
      }
      await tx.menuItemVariant.deleteMany({ where: { menuItemId } });

      // Create new variants
      if (variants.length > 0) {
        await tx.menuItemVariant.createMany({
          data: variants.map((v, i) => ({
            menuItemId,
            name: v.name,
            price: v.price,
            sku: v.sku || null,
            sortOrder: i,
          })),
        });
      }
    });

    return this.prisma.menuItemVariant.findMany({
      where: { menuItemId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ─── Modifier Groups ────────────────────────────────────────────────────────

  async createModifierGroup(tenantId: string, data: any) {
    const { modifiers, ...groupData } = data;
    return this.prisma.modifierGroup.create({
      data: {
        tenantId,
        ...groupData,
        ...(modifiers?.length && {
          modifiers: { create: modifiers },
        }),
      },
      include: { modifiers: true },
    });
  }

  async getModifierGroups(tenantId: string) {
    return this.prisma.modifierGroup.findMany({
      where: { tenantId },
      include: { modifiers: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  // ─── Tax Categories ─────────────────────────────────────────────────────────

  async getTaxCategories(tenantId: string) {
    return this.prisma.taxCategory.findMany({
      where: { tenantId, isActive: true },
    });
  }

  async createTaxCategory(tenantId: string, data: any) {
    return this.prisma.taxCategory.create({ data: { tenantId, ...data } });
  }

  // ─── Branch Prices ──────────────────────────────────────────────────────────

  async setBranchPrice(menuItemId: string, branchId: string, price: number, isAvailable = true) {
    return this.prisma.branchMenuPrice.upsert({
      where: { menuItemId_branchId: { menuItemId, branchId } },
      update: { price, isAvailable },
      create: { menuItemId, branchId, price, isAvailable },
    });
  }

  // ─── Full menu for POS (optimized single query) ─────────────────────────────

  async getPosMenu(tenantId: string, branchId: string) {
    const categories = await this.prisma.menuCategory.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        menuItems: {
          where: { isActive: true, availablePOS: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            taxCategory: { select: { rate: true, isInclusive: true } },
            modifierGroups: {
              orderBy: { sortOrder: 'asc' },
              include: {
                modifierGroup: {
                  include: {
                    modifiers: {
                      where: { isActive: true },
                      orderBy: { sortOrder: 'asc' },
                    },
                  },
                },
              },
            },
            variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
            branchPrices: { where: { branchId } },
          },
        },
      },
    });

    return categories.map(cat => ({
      ...cat,
      menuItems: cat.menuItems.map(item => {
        const bp = item.branchPrices[0];
        return {
          ...item,
          price: bp?.price ?? item.basePrice,
          isAvailable: bp?.isAvailable ?? true,
          branchPrices: undefined,
        };
      }),
    }));
  }
}
