import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Stock Items ─────────────────────────────────────────────────────────────

  async createStockItem(tenantId: string, data: any) {
    return this.prisma.stockItem.create({ data: { tenantId, ...data } });
  }

  async getStockItems(tenantId: string) {
    return this.prisma.stockItem.findMany({
      where: { tenantId, isActive: true },
      include: { category: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateStockItem(tenantId: string, id: string, data: any) {
    const item = await this.prisma.stockItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Stock item not found');
    return this.prisma.stockItem.update({ where: { id }, data });
  }

  // ─── Stock Balances ──────────────────────────────────────────────────────────

  async getBalances(tenantId: string, locationId?: string) {
    return this.prisma.stockBalance.findMany({
      where: {
        stockItem: { tenantId },
        ...(locationId && { locationId }),
      },
      include: {
        stockItem: { include: { category: true } },
        location: true,
      },
      orderBy: { stockItem: { name: 'asc' } },
    });
  }

  async getLowStockAlerts(tenantId: string) {
    const balances = await this.prisma.stockBalance.findMany({
      where: { stockItem: { tenantId } },
      include: { stockItem: true, location: true },
    });
    return balances.filter(
      b => b.stockItem.minStockLevel && Number(b.quantity) <= Number(b.stockItem.minStockLevel),
    );
  }

  // ─── Movements ───────────────────────────────────────────────────────────────

  async recordMovement(data: {
    stockItemId: string;
    locationId: string;
    type: string;
    quantity: number;
    unitCost?: number;
    reference?: string;
    referenceType?: string;
    notes?: string;
    performedById?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Record movement
      const movement = await tx.stockMovement.create({
        data: {
          stockItemId: data.stockItemId,
          locationId: data.locationId,
          type: data.type as any,
          quantity: data.quantity,
          unitCost: data.unitCost,
          reference: data.reference,
          referenceType: data.referenceType,
          notes: data.notes,
          performedById: data.performedById,
        },
      });

      // Upsert balance
      await tx.stockBalance.upsert({
        where: { stockItemId_locationId: { stockItemId: data.stockItemId, locationId: data.locationId } },
        update: {
          quantity: { increment: data.quantity },
          lastUpdatedAt: new Date(),
        },
        create: {
          stockItemId: data.stockItemId,
          locationId: data.locationId,
          quantity: data.quantity,
        },
      });

      return movement;
    });
  }

  async getMovements(tenantId: string, filters: any = {}) {
    const { stockItemId, locationId, type, from, to } = filters;
    return this.prisma.stockMovement.findMany({
      where: {
        stockItem: { tenantId },
        ...(stockItemId && { stockItemId }),
        ...(locationId && { locationId }),
        ...(type && { type }),
        ...(from && to && { createdAt: { gte: new Date(from), lte: new Date(to) } }),
      },
      include: { stockItem: true, location: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // ─── Recipes ─────────────────────────────────────────────────────────────────

  async upsertRecipe(menuItemId: string, data: any) {
    const { ingredients, ...recipeData } = data;
    return this.prisma.recipe.upsert({
      where: { menuItemId },
      update: {
        ...recipeData,
        ingredients: {
          deleteMany: {},
          create: ingredients,
        },
      },
      create: {
        menuItemId,
        ...recipeData,
        ingredients: { create: ingredients },
      },
      include: { ingredients: { include: { stockItem: true } } },
    });
  }

  async getRecipe(menuItemId: string) {
    return this.prisma.recipe.findUnique({
      where: { menuItemId },
      include: { ingredients: { include: { stockItem: true } } },
    });
  }

  // ─── Auto-deduct on order completion ─────────────────────────────────────────

  @OnEvent('order.completed')
  async handleOrderCompleted(payload: { orderId: string; tenantId: string; branchId: string }) {
    try {
      const order = await this.prisma.posOrder.findUnique({
        where: { id: payload.orderId },
        include: {
          orderItems: true,
          branch: { include: { stockLocations: { where: { isDefault: true }, take: 1 } } },
        },
      });

      if (!order) return;
      const defaultLocation = order.branch.stockLocations[0];
      if (!defaultLocation) return;

      for (const item of order.orderItems) {
        const recipe = await this.prisma.recipe.findUnique({
          where: { menuItemId: item.menuItemId },
          include: { ingredients: true },
        });
        if (!recipe) continue;

        for (const ing of recipe.ingredients) {
          const deductQty = Number(ing.quantity) * Number(ing.wasteFactor) * item.quantity * -1;
          await this.recordMovement({
            stockItemId: ing.stockItemId,
            locationId: defaultLocation.id,
            type: 'SALE_DEDUCTION',
            quantity: deductQty,
            reference: order.id,
            referenceType: 'POS_ORDER',
          }).catch(err => {
            this.logger.warn(`Stock deduction failed for item ${ing.stockItemId}: ${err.message}`);
          });
        }
      }
    } catch (err) {
      this.logger.error(`Stock deduction error for order ${payload.orderId}`, err);
    }
  }

  // ─── Stock Count (physical count reconciliation) ─────────────────────────────

  async submitStockCount(tenantId: string, locationId: string, counts: Array<{ stockItemId: string; counted: number }>, userId: string) {
    const results: { stockItemId: string; expected: number; counted: number; variance: number }[] = [];
    for (const count of counts) {
      const balance = await this.prisma.stockBalance.findUnique({
        where: { stockItemId_locationId: { stockItemId: count.stockItemId, locationId } },
      });
      const current = Number(balance?.quantity || 0);
      const variance = count.counted - current;

      if (Math.abs(variance) > 0.001) {
        await this.recordMovement({
          stockItemId: count.stockItemId,
          locationId,
          type: 'ADJUSTMENT',
          quantity: variance,
          notes: 'Physical stock count adjustment',
          performedById: userId,
        });
      }
      results.push({ stockItemId: count.stockItemId, expected: current, counted: count.counted, variance });
    }
    return results;
  }

  async getStockCategories(tenantId: string) {
    return this.prisma.stockCategory.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async createStockCategory(tenantId: string, data: any) {
    return this.prisma.stockCategory.create({ data: { tenantId, ...data } });
  }

  async getLocations(branchId: string) {
    return this.prisma.stockLocation.findMany({
      where: { branchId, isActive: true },
    });
  }

  async createLocation(branchId: string, data: any) {
    return this.prisma.stockLocation.create({ data: { branchId, ...data } });
  }
}
