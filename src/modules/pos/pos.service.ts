import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  // ─── Shifts ──────────────────────────────────────────────────────────────────

  async openShift(branchId: string, userId: string, openingFloat: number) {
    const open = await this.prisma.posShift.findFirst({
      where: { branchId, status: 'OPEN' },
    });
    if (open) throw new BadRequestException('A shift is already open for this branch');

    return this.prisma.posShift.create({
      data: { branchId, openedById: userId, openingFloat, status: 'OPEN' },
    });
  }

  async closeShift(shiftId: string, userId: string, closingCash: number, notes?: string) {
    const shift = await this.prisma.posShift.findUnique({
      where: { id: shiftId },
      include: {
        posOrders: {
          where: { status: 'COMPLETED' },
          include: { payments: true },
        },
        cashMovements: true,
      },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.status === 'CLOSED') throw new BadRequestException('Shift already closed');

    // Calculate X/Z report data
    const totalSales = shift.posOrders.reduce(
      (sum, o) => sum + Number(o.total), 0,
    );
    const totalOrders = shift.posOrders.length;
    const cashIn = shift.cashMovements
      .filter(m => m.type === 'CASH_IN')
      .reduce((s, m) => s + Number(m.amount), 0);
    const cashOut = shift.cashMovements
      .filter(m => m.type === 'CASH_OUT' || m.type === 'PETTY_CASH')
      .reduce((s, m) => s + Number(m.amount), 0);

    const cashOrders = shift.posOrders.flatMap(o => o.payments)
      .filter(p => p.method === 'CASH' && p.status === 'COMPLETED')
      .reduce((s, p) => s + Number(p.amount), 0);

    const expectedCash = Number(shift.openingFloat) + cashOrders + cashIn - cashOut;
    const cashVariance = closingCash - expectedCash;

    const reportData = {
      branchId: shift.branchId,
      openedAt: shift.openedAt,
      closedAt: new Date(),
      openingFloat: shift.openingFloat,
      closingCash,
      expectedCash,
      cashVariance,
      totalOrders,
      totalSales,
      byPaymentMethod: this.summarizeByPaymentMethod(shift.posOrders),
    };

    const closed = await this.prisma.posShift.update({
      where: { id: shiftId },
      data: {
        closedById: userId,
        closedAt: new Date(),
        status: 'CLOSED',
        closingCash,
        expectedCash,
        cashVariance,
        totalSales,
        totalOrders,
        notes,
        zReportData: reportData,
      },
    });

    // Trigger daily summary computation in FinanceService
    this.eventEmitter.emit('shift.closed', {
      branchId: shift.branchId,
      date: new Date().toISOString(),
    });

    return closed;
  }

  async getActiveShift(branchId: string) {
    return this.prisma.posShift.findFirst({
      where: { branchId, status: 'OPEN' },
      include: { openedBy: { select: { id: true, fullName: true } } },
    });
  }

  async addCashMovement(shiftId: string, type: string, amount: number, reason: string, userId: string) {
    const shift = await this.prisma.posShift.findUnique({ where: { id: shiftId } });
    if (!shift || shift.status !== 'OPEN') throw new BadRequestException('No open shift found');

    return this.prisma.cashMovement.create({
      data: { shiftId, type: type as any, amount, reason, performedById: userId },
    });
  }

  // ─── Orders ──────────────────────────────────────────────────────────────────

  async createOrder(tenantId: string, branchId: string, userId: string, data: any) {
    // Build order number
    const count = await this.prisma.posOrder.count({ where: { branchId } });
    const orderNumber = `ORD-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    // Calculate totals
    const { items, tableId, customerId, orderType, notes, source, paymentMethod } = data;

    // Payment-method-based tax: CASH = 16%, card/digital = 5%
    const CASH_TAX = 16;
    const CARD_TAX = 5;
    const isCash = !paymentMethod || paymentMethod === 'CASH';
    const effectiveTaxRate = isCash ? CASH_TAX : CARD_TAX;

    const orderItems = await Promise.all(
      items.map(async (item: any) => {
        const menuItem = await this.prisma.menuItem.findUnique({
          where: { id: item.menuItemId },
          include: { branchPrices: { where: { branchId } } },
        });
        if (!menuItem) throw new NotFoundException(`Menu item ${item.menuItemId} not found`);

        const price = Number(menuItem.branchPrices[0]?.price ?? menuItem.basePrice);
        const modifiersTotal = (item.modifiers || []).reduce(
          (s: number, m: any) => s + Number(m.priceAdjustment || 0), 0,
        );
        const unitPrice = price + modifiersTotal;

        const taxAmount = (unitPrice * item.quantity * effectiveTaxRate) / 100;
        const lineTotal = unitPrice * item.quantity + taxAmount;

        return {
          menuItemId: item.menuItemId,
          itemName: menuItem.name,
          itemSku: menuItem.sku,
          unitPrice,
          quantity: item.quantity,
          taxRate: effectiveTaxRate,
          taxAmount,
          lineTotal,
          notes: item.notes,
          modifiers: (item.modifiers || []).map((m: any) => ({
            modifierId: m.modifierId,
            modifierName: m.modifierName,
            priceAdjustment: m.priceAdjustment || 0,
          })),
        };
      }),
    );

    const subtotal = orderItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const taxAmount = orderItems.reduce((s, i) => s + i.taxAmount, 0);
    const total = orderItems.reduce((s, i) => s + i.lineTotal, 0);

    const order = await this.prisma.posOrder.create({
      data: {
        tenantId,
        branchId,
        tableId,
        customerId,
        createdById: userId,
        orderNumber,
        orderType: orderType || 'DINE_IN',
        status: 'PENDING',
        source: source || 'POS',
        subtotal,
        taxAmount,
        total,
        notes,
        orderItems: {
          create: orderItems.map(({ modifiers, ...item }) => ({
            ...item,
            modifiers: modifiers?.length
              ? { create: modifiers }
              : undefined,
          })),
        },
      },
      include: {
        orderItems: { include: { modifiers: true } },
        table: { select: { number: true, section: true } },
        customer: { select: { id: true, fullName: true } },
      },
    });

    // Update table status
    if (tableId) {
      await this.prisma.restaurantTable.update({
        where: { id: tableId },
        data: { status: 'OCCUPIED' },
      });
    }

    // Emit event for KDS
    this.eventEmitter.emit('order.created', order);

    return order;
  }

  async getOrders(tenantId: string, branchId: string, filters: any = {}) {
    const { status, orderType, date, page = 1, limit = 50 } = filters;
    const skip = (page - 1) * limit;

    return this.prisma.posOrder.findMany({
      where: {
        tenantId,
        branchId,
        ...(status && { status }),
        ...(orderType && { orderType }),
        ...(date && {
          createdAt: {
            gte: new Date(date),
            lt: new Date(new Date(date).getTime() + 86400000),
          },
        }),
      },
      include: {
        orderItems: { include: { modifiers: true } },
        payments: true,
        table: { select: { number: true, section: true } },
        customer: { select: { id: true, fullName: true } },
        createdBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });
  }

  async getOrder(tenantId: string, id: string) {
    const order = await this.prisma.posOrder.findFirst({
      where: { id, tenantId },
      include: {
        orderItems: { include: { modifiers: true, menuItem: { select: { name: true, image: true } } } },
        payments: true,
        refunds: true,
        kitchenTickets: true,
        table: true,
        customer: true,
        createdBy: { select: { fullName: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async updateOrderStatus(tenantId: string, id: string, status: string) {
    const order = await this.prisma.posOrder.findFirst({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Order not found');

    const updated = await this.prisma.posOrder.update({
      where: { id },
      data: {
        status: status as any,
        ...(status === 'COMPLETED' && { completedAt: new Date() }),
        ...(status === 'CANCELLED' && { cancelledAt: new Date() }),
      },
    });

    // Free the table when order completes
    if (status === 'COMPLETED' && order.tableId) {
      await this.prisma.restaurantTable.update({
        where: { id: order.tableId },
        data: { status: 'AVAILABLE' },
      });
    }

    this.eventEmitter.emit('order.statusChanged', { orderId: id, status });
    return updated;
  }

  // ─── Payments ────────────────────────────────────────────────────────────────

  async processPayment(tenantId: string, orderId: string, payments: any[]) {
    const order = await this.getOrder(tenantId, orderId);

    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
    if (totalPaid < Number(order.total)) {
      throw new BadRequestException(
        `Payment of ${totalPaid} is less than order total ${order.total}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Insert all payment rows
      await tx.posPayment.createMany({
        data: payments.map(p => ({
          orderId,
          method: p.method,
          amount: p.amount,
          reference: p.reference,
          status: 'COMPLETED',
        })),
      });

      // Mark order completed
      await tx.posOrder.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      // Free table
      if (order.tableId) {
        await tx.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: 'AVAILABLE' },
        });
      }

      // Award loyalty points if customer
      if (order.customerId) {
        await this.awardLoyaltyPoints(tx, tenantId, order.customerId, Number(order.total), orderId);
      }
    });

    // Trigger recipe-based stock deduction (async)
    this.eventEmitter.emit('order.completed', { orderId, tenantId, branchId: order.branchId });

    // Queue FBR submission
    this.eventEmitter.emit('fbr.submitInvoice', { orderId, tenantId });

    return { message: 'Payment processed successfully' };
  }

  async processRefund(tenantId: string, orderId: string, amount: number, reason: string, method: string, userId: string) {
    const order = await this.getOrder(tenantId, orderId);
    if (order.status !== 'COMPLETED') {
      throw new BadRequestException('Can only refund completed orders');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.refund.create({
        data: { orderId, amount, reason, method: method as any, processedById: userId },
      });
      await tx.posOrder.update({
        where: { id: orderId },
        data: { status: 'REFUNDED' },
      });
    });

    return { message: 'Refund processed' };
  }

  // ─── Tables ──────────────────────────────────────────────────────────────────

  async getTables(branchId: string) {
    return this.prisma.restaurantTable.findMany({
      where: { branchId, isActive: true },
      include: {
        posOrders: {
          where: { status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] } },
          include: { orderItems: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { number: 'asc' },
    });
  }

  async createTable(branchId: string, data: any) {
    return this.prisma.restaurantTable.create({ data: { branchId, ...data } });
  }

  async updateTableStatus(branchId: string, tableId: string, status: string) {
    return this.prisma.restaurantTable.updateMany({
      where: { id: tableId, branchId },
      data: { status: status as any },
    });
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async awardLoyaltyPoints(tx: any, tenantId: string, customerId: string, amount: number, orderId: string) {
    const program = await tx.loyaltyProgram.findUnique({ where: { tenantId } });
    if (!program || !program.isActive) return;

    const account = await tx.loyaltyAccount.findUnique({ where: { customerId } });
    if (!account) return;

    const tier = account.tierId
      ? await tx.loyaltyTier.findUnique({ where: { id: account.tierId } })
      : null;
    const multiplier = tier ? Number(tier.multiplier) : 1;
    const points = Math.floor(amount * Number(program.pointsPerPkr) * multiplier);

    if (points > 0) {
      await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: {
          points: { increment: points },
          lifetimePoints: { increment: points },
        },
      });
      await tx.loyaltyTransaction.create({
        data: {
          accountId: account.id,
          points,
          type: 'EARNED',
          reference: orderId,
          description: `Earned from order ${orderId}`,
        },
      });
    }
  }

  private summarizeByPaymentMethod(orders: any[]) {
    const summary: Record<string, number> = {};
    for (const order of orders) {
      for (const payment of order.payments || []) {
        summary[payment.method] = (summary[payment.method] || 0) + Number(payment.amount);
      }
    }
    return summary;
  }
}
