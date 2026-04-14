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
    return this.prisma.menuCategory.update({ where: { id }, data: { isActive: false } });
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
        modifierGroups: { include: { modifierGroup: { include: { modifiers: true } } } },
        recipe: { include: { ingredients: { include: { stockItem: true } } } },
      },
    });
  }

  async getItems(tenantId: string, categoryId?: string, branchId?: string) {
    const items = await this.prisma.menuItem.findMany({
      where: { tenantId, isActive: true, ...(categoryId && { categoryId }) },
      include: {
        category: { select: { id: true, name: true } },
        taxCategory: { select: { id: true, name: true, rate: true } },
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
        modifierGroups: {
          include: { modifierGroup: { include: { modifiers: true } } },
        },
        recipe: { include: { ingredients: { include: { stockItem: true } } } },
        branchPrices: true,
      },
    });
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async updateItem(tenantId: string, id: string, data: any) {
    await this.getItem(tenantId, id);
    const { modifierGroupIds, ...itemData } = data;
    return this.prisma.menuItem.update({ where: { id }, data: itemData });
  }

  async deleteItem(tenantId: string, id: string) {
    await this.getItem(tenantId, id);
    return this.prisma.menuItem.update({ where: { id }, data: { isActive: false } });
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
