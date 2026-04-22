import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OnEvent } from '@nestjs/event-emitter';

// ─── Unit conversion ────────────────────────────────────────────────────────
const TO_BASE: Record<string, { family: string; factor: number }> = {
  g: { family: 'w', factor: 1 }, kg: { family: 'w', factor: 1000 }, mg: { family: 'w', factor: 0.001 },
  lb: { family: 'w', factor: 453.592 }, oz: { family: 'w', factor: 28.3495 },
  ml: { family: 'v', factor: 1 }, L: { family: 'v', factor: 1000 }, cl: { family: 'v', factor: 10 },
  pcs: { family: 'c', factor: 1 }, dozen: { family: 'c', factor: 12 },
};
function convertUnit(qty: number, from: string, to: string): number {
  if (from === to) return qty;
  const f = TO_BASE[from], t = TO_BASE[to];
  if (!f || !t || f.family !== t.family) return qty; // fallback: no conversion
  return (qty * f.factor) / t.factor;
}

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
      include: {
        category: true,
        batches: {
          where: { status: { in: ['ACTIVE', 'WAITING'] } },
          orderBy: { receivedDate: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async updateStockItem(tenantId: string, id: string, data: any) {
    const item = await this.prisma.stockItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Stock item not found');
    return this.prisma.stockItem.update({ where: { id }, data });
  }

  // ─── Stock Batches (FIFO brand tracking) ─────────────────────────────────────

  async addBatch(stockItemId: string, data: any) {
    const packSize = Number(data.packSize);
    const purchasePrice = Number(data.purchasePrice);
    const unitCost = packSize > 0 ? parseFloat((purchasePrice / packSize).toFixed(4)) : 0;
    const quantityReceived = packSize;

    // Check if there's already an active batch — if not, this one becomes active
    const activeBatch = await this.prisma.stockBatch.findFirst({
      where: { stockItemId, status: 'ACTIVE' },
    });

    const batch = await this.prisma.stockBatch.create({
      data: {
        stockItemId,
        locationId: data.locationId || null,
        brandName: data.brandName,
        supplier: data.supplier || null,
        packSize,
        packUnit: data.packUnit || null,
        purchasePrice,
        unitCost,
        quantityReceived,
        remaining: quantityReceived,
        status: activeBatch ? 'WAITING' : 'ACTIVE',
        receivedDate: new Date(data.receivedDate || new Date()),
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        batchNumber: data.batchNumber || null,
        notes: data.notes || null,
      },
    });

    // Update the stock item's unitCost to the latest batch (for cost analysis display)
    await this.prisma.stockItem.update({
      where: { id: stockItemId },
      data: { unitCost: activeBatch ? undefined : unitCost },
    });

    return batch;
  }

  async getBatches(stockItemId: string) {
    return this.prisma.stockBatch.findMany({
      where: { stockItemId },
      orderBy: [{ status: 'asc' }, { receivedDate: 'asc' }],
    });
  }

  async updateBatch(id: string, data: any) {
    const batch = await this.prisma.stockBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Batch not found');

    const updates: any = {};
    if (data.brandName !== undefined) updates.brandName = data.brandName;
    if (data.supplier !== undefined) updates.supplier = data.supplier;
    if (data.packUnit !== undefined) updates.packUnit = data.packUnit;
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.remaining !== undefined) updates.remaining = data.remaining;
    if (data.packSize !== undefined && data.purchasePrice !== undefined) {
      updates.packSize = data.packSize;
      updates.purchasePrice = data.purchasePrice;
      updates.unitCost = parseFloat((data.purchasePrice / data.packSize).toFixed(4));
    } else if (data.packSize !== undefined) {
      updates.packSize = data.packSize;
      updates.unitCost = parseFloat((Number(batch.purchasePrice) / data.packSize).toFixed(4));
    } else if (data.purchasePrice !== undefined) {
      updates.purchasePrice = data.purchasePrice;
      updates.unitCost = parseFloat((data.purchasePrice / Number(batch.packSize)).toFixed(4));
    }

    const updated = await this.prisma.stockBatch.update({ where: { id }, data: updates });

    // If this is the active batch, update the stock item's unitCost too
    if (updated.status === 'ACTIVE' && updates.unitCost) {
      await this.prisma.stockItem.update({
        where: { id: updated.stockItemId },
        data: { unitCost: updates.unitCost },
      });
    }

    return updated;
  }

  async deleteBatch(id: string) {
    await this.prisma.stockBatch.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * FIFO deduction: deduct quantity from the oldest active batch first.
   * If the active batch runs out, mark it DEPLETED and activate the next WAITING batch.
   * Updates the stock item's unitCost to the newly active batch's rate.
   */
  async deductFromBatches(stockItemId: string, quantity: number): Promise<{ deducted: number; activeBrandName: string | null }> {
    let remaining = quantity;
    let activeBrandName: string | null = null;

    // Get batches in FIFO order: ACTIVE first, then WAITING by receivedDate
    const batches = await this.prisma.stockBatch.findMany({
      where: { stockItemId, status: { in: ['ACTIVE', 'WAITING'] } },
      orderBy: [{ status: 'asc' }, { receivedDate: 'asc' }],
    });

    for (const batch of batches) {
      if (remaining <= 0) break;

      const batchRemaining = Number(batch.remaining);
      if (batchRemaining <= 0) continue;

      // Activate waiting batch if no active one
      if (batch.status === 'WAITING') {
        await this.prisma.stockBatch.update({
          where: { id: batch.id },
          data: { status: 'ACTIVE' },
        });
        // Update stock item cost to this batch's rate
        await this.prisma.stockItem.update({
          where: { id: stockItemId },
          data: { unitCost: batch.unitCost },
        });
      }

      const deductFromThis = Math.min(remaining, batchRemaining);
      const newRemaining = parseFloat((batchRemaining - deductFromThis).toFixed(3));

      await this.prisma.stockBatch.update({
        where: { id: batch.id },
        data: {
          remaining: newRemaining,
          status: newRemaining <= 0 ? 'DEPLETED' : 'ACTIVE',
        },
      });

      remaining -= deductFromThis;
      activeBrandName = batch.brandName;

      // If this batch is now depleted, activate the next waiting one
      if (newRemaining <= 0) {
        const nextBatch = await this.prisma.stockBatch.findFirst({
          where: { stockItemId, status: 'WAITING' },
          orderBy: { receivedDate: 'asc' },
        });
        if (nextBatch) {
          await this.prisma.stockBatch.update({
            where: { id: nextBatch.id },
            data: { status: 'ACTIVE' },
          });
          await this.prisma.stockItem.update({
            where: { id: stockItemId },
            data: { unitCost: nextBatch.unitCost },
          });
          activeBrandName = nextBatch.brandName;
        }
      }
    }

    return { deducted: quantity - remaining, activeBrandName };
  }

  // ─── Prep Recipes (house-made sauces/dressings) ──────────────────────────────

  async upsertPrepRecipe(stockItemId: string, data: any) {
    const { ingredients, yield: batchYield, notes } = data;

    // Mark item as house-made
    await this.prisma.stockItem.update({ where: { id: stockItemId }, data: { isHouseMade: true } });

    const existing = await this.prisma.prepRecipe.findUnique({ where: { stockItemId } });

    if (existing) {
      return this.prisma.prepRecipe.update({
        where: { id: existing.id },
        data: {
          yield: batchYield,
          notes,
          ingredients: { deleteMany: {}, create: ingredients },
        },
        include: { ingredients: { include: { stockItem: true } } },
      });
    }

    return this.prisma.prepRecipe.create({
      data: {
        stockItemId,
        yield: batchYield,
        notes,
        ingredients: { create: ingredients },
      },
      include: { ingredients: { include: { stockItem: true } } },
    });
  }

  async getPrepRecipe(stockItemId: string) {
    return this.prisma.prepRecipe.findUnique({
      where: { stockItemId },
      include: { ingredients: { include: { stockItem: true } } },
    });
  }

  /**
   * "Make a Batch" — deducts raw ingredients, adds house-made stock.
   * @param stockItemId The house-made item (e.g. Garlic Aioli)
   * @param batches How many batches to produce (default 1)
   * @param locationId Where to add/deduct stock
   */
  async producePrep(stockItemId: string, locationId: string, batches = 1) {
    const recipe = await this.prisma.prepRecipe.findUnique({
      where: { stockItemId },
      include: { ingredients: { include: { stockItem: true } } },
    });
    if (!recipe) throw new NotFoundException('No prep recipe found for this item');

    const batchYield = Number(recipe.yield) * batches;

    // Deduct raw ingredients
    for (const ing of recipe.ingredients) {
      const rawQty = Number(ing.quantity) * batches;
      const stockUnit = ing.stockItem.unit;
      const convertedQty = convertUnit(rawQty, ing.unit, stockUnit);

      // FIFO batch deduction
      await this.deductFromBatches(ing.stockItemId, convertedQty).catch(() => {});

      // Record movement
      await this.recordMovement({
        stockItemId: ing.stockItemId,
        locationId,
        type: 'SALE_DEDUCTION',
        quantity: convertedQty * -1,
        reference: stockItemId,
        referenceType: 'PREP_PRODUCTION',
        notes: `Used for prep: ${batches} batch(es)`,
      }).catch(() => {});
    }

    // Add the produced item to stock
    await this.recordMovement({
      stockItemId,
      locationId,
      type: 'PURCHASE',
      quantity: batchYield,
      reference: stockItemId,
      referenceType: 'PREP_PRODUCTION',
      notes: `Produced ${batches} batch(es) = ${batchYield} ${(await this.prisma.stockItem.findUnique({ where: { id: stockItemId }, select: { unit: true } }))?.unit}`,
    });

    // Calculate cost: sum of raw ingredient costs
    let totalCost = 0;
    for (const ing of recipe.ingredients) {
      const rawQty = Number(ing.quantity) * batches;
      const convertedQty = convertUnit(rawQty, ing.unit, ing.stockItem.unit);
      totalCost += convertedQty * Number(ing.stockItem.unitCost || 0);
    }
    const unitCost = batchYield > 0 ? parseFloat((totalCost / batchYield).toFixed(4)) : 0;

    // Update the stock item's unit cost based on production cost
    await this.prisma.stockItem.update({
      where: { id: stockItemId },
      data: { unitCost },
    });

    return { produced: batchYield, unitCost, totalCost, batches };
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
    const { ingredients, variantId, ...recipeData } = data;
    const vId = variantId || null;

    // Find existing recipe
    const existing = await this.prisma.recipe.findFirst({
      where: { menuItemId, variantId: vId },
    });

    if (existing) {
      return this.prisma.recipe.update({
        where: { id: existing.id },
        data: {
          ...recipeData,
          ingredients: { deleteMany: {}, create: ingredients },
        },
        include: { ingredients: { include: { stockItem: true } } },
      });
    }

    return this.prisma.recipe.create({
      data: {
        menuItemId,
        variantId: vId,
        ...recipeData,
        ingredients: { create: ingredients },
      },
      include: { ingredients: { include: { stockItem: true } } },
    });
  }

  async getRecipe(menuItemId: string, variantId?: string) {
    return this.prisma.recipe.findFirst({
      where: { menuItemId, variantId: variantId || null },
      include: { ingredients: { include: { stockItem: true } } },
    });
  }

  async getRecipesForItem(menuItemId: string) {
    return this.prisma.recipe.findMany({
      where: { menuItemId },
      include: { ingredients: { include: { stockItem: true } }, variant: true },
    });
  }

  // ─── Auto-deduct on order completion ─────────────────────────────────────────

  @OnEvent('order.completed')
  async handleOrderCompleted(payload: { orderId: string; tenantId: string; branchId: string }) {
    try {
      const order = await this.prisma.posOrder.findUnique({
        where: { id: payload.orderId },
        include: {
          orderItems: { include: { menuItem: { select: { itemType: true, name: true } } } },
          branch: { include: { stockLocations: { where: { isDefault: true }, take: 1 } } },
        },
      });

      if (!order) return;
      const defaultLocation = order.branch.stockLocations[0];
      if (!defaultLocation) return;

      const isTakeaway = order.orderType === 'TAKEAWAY' || order.orderType === 'DELIVERY';

      // ── Recipe-based deductions ──
      for (const item of order.orderItems) {
        // Look up recipe: variant-specific first, then base recipe
        let recipe = await this.prisma.recipe.findFirst({
          where: { menuItemId: item.menuItemId, variantId: item.variantId || null },
          include: { ingredients: true },
        });
        if (!recipe && item.variantId) {
          // Fallback to base recipe if no variant-specific one
          recipe = await this.prisma.recipe.findFirst({
            where: { menuItemId: item.menuItemId, variantId: null },
            include: { ingredients: true },
          });
        }
        if (!recipe) continue;

        for (const ing of recipe.ingredients) {
          // Convert recipe unit to stock unit (e.g. 10g → 0.01kg)
          const stockItem = await this.prisma.stockItem.findUnique({ where: { id: ing.stockItemId }, select: { unit: true } });
          const convertedQty = convertUnit(Number(ing.quantity), ing.unit, stockItem?.unit || ing.unit);
          const deductQty = convertedQty * Number(ing.wasteFactor) * item.quantity;

          // FIFO batch deduction
          await this.deductFromBatches(ing.stockItemId, deductQty).catch(err => {
            this.logger.warn(`Batch deduction failed for ${ing.stockItemId}: ${err.message}`);
          });

          // Also record in stock movements + balance (for overall tracking)
          await this.recordMovement({
            stockItemId: ing.stockItemId,
            locationId: defaultLocation.id,
            type: 'SALE_DEDUCTION',
            quantity: deductQty * -1,
            reference: order.id,
            referenceType: 'POS_ORDER',
          }).catch(err => {
            this.logger.warn(`Stock movement failed for item ${ing.stockItemId}: ${err.message}`);
          });
        }
      }

      // ── Packaging auto-deduction (takeaway/delivery only, config-driven) ──
      if (isTakeaway) {
        await this.deductPackaging(order, defaultLocation.id);
      }
    } catch (err) {
      this.logger.error(`Stock deduction error for order ${payload.orderId}`, err);
    }
  }

  private async deductPackaging(order: any, locationId: string) {
    // Load packaging rules for this tenant — if none exist, nothing happens
    const rules = await this.prisma.packagingRule.findMany({
      where: { tenantId: order.tenantId, isActive: true },
    });
    if (rules.length === 0) return;

    const orderTypes = [order.orderType, 'ANY'];
    let hasFood = false;

    for (const item of order.orderItems) {
      const itemType = item.menuItem?.itemType || 'FOOD';
      const itemName = (item.itemName || '').toLowerCase();
      const sizeTag = itemName.includes('(large)') ? 'LARGE' : 'SMALL';

      if (itemType === 'FOOD') hasFood = true;

      // Find matching per-item rules
      const matching = rules.filter(r =>
        r.scope === 'PER_ITEM' &&
        orderTypes.includes(r.orderType) &&
        (r.itemType === itemType || r.itemType === 'ANY') &&
        (r.sizeTag === sizeTag || r.sizeTag === 'ANY' || !r.sizeTag)
      );

      for (const rule of matching) {
        await this.recordMovement({
          stockItemId: rule.stockItemId,
          locationId,
          type: 'SALE_DEDUCTION',
          quantity: rule.quantity * item.quantity * -1,
          reference: order.id,
          referenceType: 'PACKAGING',
        }).catch(err => this.logger.warn(`Packaging deduction failed: ${err.message}`));
      }
    }

    // Per-order rules (e.g. 1 carry bag per order)
    const perOrderRules = rules.filter(r =>
      r.scope === 'PER_ORDER' &&
      orderTypes.includes(r.orderType) &&
      (r.itemType === 'ANY' || (r.itemType === 'FOOD' && hasFood))
    );

    for (const rule of perOrderRules) {
      await this.recordMovement({
        stockItemId: rule.stockItemId,
        locationId,
        type: 'SALE_DEDUCTION',
        quantity: rule.quantity * -1,
        reference: order.id,
        referenceType: 'PACKAGING',
      }).catch(err => this.logger.warn(`Packaging deduction failed: ${err.message}`));
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

  // ─── Cost Analysis ──────────────────────────────────────────────────────────

  async getCostAnalysis(tenantId: string) {
    const items = await this.prisma.menuItem.findMany({
      where: { tenantId, isActive: true },
      include: {
        category: { select: { name: true } },
        variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        recipes: {
          include: { ingredients: { include: { stockItem: { select: { name: true, unit: true, unitCost: true } } } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    const results: any[] = [];

    for (const item of items) {
      if (item.variants.length > 0) {
        // Per-variant rows
        for (const v of item.variants) {
          const recipe = item.recipes.find(r => r.variantId === v.id);
          const recipeCost = recipe
            ? recipe.ingredients.reduce((sum, ing) => {
                return sum + convertUnit(Number(ing.quantity), ing.unit, ing.stockItem.unit) * Number(ing.wasteFactor) * Number(ing.stockItem.unitCost ?? 0);
              }, 0)
            : null;
          const price = Number(v.price);
          const margin = recipeCost !== null && price > 0 ? ((price - recipeCost) / price) * 100 : null;
          results.push({
            id: item.id, variantId: v.id,
            name: `${item.name} (${v.name})`,
            category: item.category?.name, itemType: item.itemType,
            sellingPrice: price, recipeCost,
            profit: recipeCost !== null ? price - recipeCost : null,
            margin, hasRecipe: !!recipe,
            ingredientCount: recipe?.ingredients.length ?? 0,
          });
        }
      } else {
        // No variants — base recipe
        const recipe = item.recipes.find(r => !r.variantId);
        const recipeCost = recipe
          ? recipe.ingredients.reduce((sum, ing) => {
              return sum + convertUnit(Number(ing.quantity), ing.unit, ing.stockItem.unit) * Number(ing.wasteFactor) * Number(ing.stockItem.unitCost ?? 0);
            }, 0)
          : null;
        const price = Number(item.basePrice);
        const margin = recipeCost !== null && price > 0 ? ((price - recipeCost) / price) * 100 : null;
        results.push({
          id: item.id, variantId: null,
          name: item.name,
          category: item.category?.name, itemType: item.itemType,
          sellingPrice: price, recipeCost,
          profit: recipeCost !== null ? price - recipeCost : null,
          margin, hasRecipe: !!recipe,
          ingredientCount: recipe?.ingredients.length ?? 0,
        });
      }
    }

    return results;
  }

  // ─── Packaging Rules ────────────────────────────────────────────────────────

  async getPackagingRules(tenantId: string) {
    return this.prisma.packagingRule.findMany({
      where: { tenantId },
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createPackagingRule(tenantId: string, data: any) {
    return this.prisma.packagingRule.create({
      data: { tenantId, ...data },
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
    });
  }

  async deletePackagingRule(id: string) {
    await this.prisma.packagingRule.delete({ where: { id } });
    return { deleted: true };
  }
}
