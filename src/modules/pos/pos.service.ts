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
        posOrders: { include: { payments: true, orderItems: true } },
        cashMovements: true,
        openedBy: { select: { fullName: true } },
        branch: { select: { name: true } },
      },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.status === 'CLOSED') throw new BadRequestException('Shift already closed');

    const completedOrders = shift.posOrders.filter(o => o.status === 'COMPLETED');
    const cancelledOrders = shift.posOrders.filter(o => o.status === 'CANCELLED');
    const refundedOrders = shift.posOrders.filter(o => o.status === 'REFUNDED');

    const totalSales = completedOrders.reduce((s, o) => s + Number(o.total), 0);
    const totalSubtotal = completedOrders.reduce((s, o) => s + Number(o.subtotal), 0);
    const totalTax = completedOrders.reduce((s, o) => s + Number(o.taxAmount), 0);
    const totalOrders = completedOrders.length;

    const cashIn = shift.cashMovements.filter(m => m.type === 'CASH_IN').reduce((s, m) => s + Number(m.amount), 0);
    const cashOut = shift.cashMovements.filter(m => m.type === 'CASH_OUT' || m.type === 'PETTY_CASH').reduce((s, m) => s + Number(m.amount), 0);

    const allPayments = completedOrders.flatMap(o => o.payments).filter(p => p.status === 'COMPLETED');
    const cashSales = allPayments.filter(p => p.method === 'CASH').reduce((s, p) => s + Number(p.amount), 0);
    const cardSales = allPayments.filter(p => p.method === 'CARD').reduce((s, p) => s + Number(p.amount), 0);
    const bankSales = allPayments.filter(p => p.method === 'BANK_TRANSFER').reduce((s, p) => s + Number(p.amount), 0);

    const expectedCash = Number(shift.openingFloat) + cashSales + cashIn - cashOut;
    const cashVariance = closingCash - expectedCash;

    // Top items sold
    const itemMap: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const order of completedOrders) {
      for (const item of order.orderItems) {
        if (!itemMap[item.itemName]) itemMap[item.itemName] = { name: item.itemName, qty: 0, revenue: 0 };
        itemMap[item.itemName].qty += item.quantity;
        itemMap[item.itemName].revenue += Number(item.lineTotal);
      }
    }
    const topItems = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 15);

    // Order type breakdown
    const dineIn = completedOrders.filter(o => o.orderType === 'DINE_IN').length;
    const takeaway = completedOrders.filter(o => o.orderType === 'TAKEAWAY').length;
    const delivery = completedOrders.filter(o => o.orderType === 'DELIVERY').length;

    // Commission summary
    const commissionOrders = completedOrders.filter(o => o.orderTakerId);
    const totalCommission = commissionOrders.reduce((s, o) => s + Number((o as any).commissionAmount || 0), 0);
    const commissionByTaker: Record<string, { name: string; orders: number; commission: number }> = {};
    for (const o of commissionOrders) {
      const key = o.orderTakerId!;
      if (!commissionByTaker[key]) commissionByTaker[key] = { name: (o as any).orderTakerName || 'Unknown', orders: 0, commission: 0 };
      commissionByTaker[key].orders += 1;
      commissionByTaker[key].commission += Number((o as any).commissionAmount || 0);
    }

    const reportData = {
      branchName: shift.branch.name,
      openedBy: shift.openedBy.fullName,
      openedAt: shift.openedAt,
      closedAt: new Date(),
      openingFloat: Number(shift.openingFloat),
      closingCash,
      expectedCash,
      cashVariance,
      totalOrders,
      totalSales,
      totalSubtotal,
      totalTax,
      cashSales,
      cardSales,
      bankSales,
      cashIn,
      cashOut,
      voidedOrders: cancelledOrders.length,
      refundedOrders: refundedOrders.length,
      avgOrderValue: totalOrders > 0 ? totalSales / totalOrders : 0,
      orderTypes: { dineIn, takeaway, delivery },
      topItems,
      // Commission
      totalCommission,
      commissionByTaker: Object.values(commissionByTaker),
      netCashAfterCommission: closingCash - totalCommission,
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
      include: { openedBy: { select: { fullName: true } }, branch: { select: { name: true } } },
    });

    this.eventEmitter.emit('shift.closed', {
      branchId: shift.branchId,
      date: new Date().toISOString(),
    });

    return { ...closed, zReport: reportData };
  }

  async getActiveShift(branchId: string) {
    return this.prisma.posShift.findFirst({
      where: { branchId, status: 'OPEN' },
      include: { openedBy: { select: { id: true, fullName: true } } },
    });
  }

  async getClosedShifts(branchId: string, limit = 50) {
    return this.prisma.posShift.findMany({
      where: { branchId, status: 'CLOSED' },
      include: {
        openedBy: { select: { fullName: true } },
        closedBy: { select: { fullName: true } },
      },
      orderBy: { closedAt: 'desc' },
      take: limit,
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
    const { items, tableId, customerId, orderType, notes, source, paymentMethod, servedById, discount, orderTakerId } = data;

    // DINE_IN must have a table
    if ((orderType || 'DINE_IN') === 'DINE_IN' && !tableId) {
      throw new BadRequestException('Dine-in orders require a table');
    }

    // Payment-method-based tax: CASH = 16%, card/digital = 5%
    const CASH_TAX = 16;
    const CARD_TAX = 5;
    const isCash = !paymentMethod || paymentMethod === 'CASH';
    const effectiveTaxRate = isCash ? CASH_TAX : CARD_TAX;

    const orderItems = await Promise.all(
      items.map(async (item: any) => {
        const menuItem = await this.prisma.menuItem.findUnique({
          where: { id: item.menuItemId },
          include: { branchPrices: { where: { branchId } }, variants: true },
        });
        if (!menuItem) throw new NotFoundException(`Menu item ${item.menuItemId} not found`);

        // Use variant price if a variant was selected, otherwise base/branch price
        let price: number;
        if (item.variantId) {
          const variant = menuItem.variants.find((v: any) => v.id === item.variantId);
          price = variant ? Number(variant.price) : Number(menuItem.basePrice);
        } else {
          price = Number(menuItem.branchPrices[0]?.price ?? menuItem.basePrice);
        }
        const modifiersTotal = (item.modifiers || []).reduce(
          (s: number, m: any) => s + Number(m.priceAdjustment || 0), 0,
        );
        const unitPrice = price + modifiersTotal;

        const taxAmount = (unitPrice * item.quantity * effectiveTaxRate) / 100;
        const lineTotal = unitPrice * item.quantity + taxAmount;

        const variantLabel = item.variantName ? ` (${item.variantName})` : '';
        return {
          menuItemId: item.menuItemId,
          variantId: item.variantId || null,
          variantName: item.variantName || null,
          itemName: `${menuItem.name}${variantLabel}`,
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

    const rawSubtotal = orderItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    // Apply discount
    let discountAmount = 0;
    let discountNotes = '';
    if (discount) {
      discountAmount = discount.type === 'PERCENT'
        ? (rawSubtotal * discount.value) / 100
        : discount.value;
      discountAmount = Math.min(discountAmount, rawSubtotal);
      discountNotes = `${discount.type === 'PERCENT' ? `${discount.value}%` : `₨${discount.value}`} — ${discount.reason}`;
    }

    const subtotal = rawSubtotal - discountAmount;
    const taxAmount = parseFloat(((subtotal * effectiveTaxRate) / 100).toFixed(2));
    const total = parseFloat((subtotal + taxAmount).toFixed(2));

    // Order taker commission
    let orderTakerName: string | null = null;
    let commissionRate: number | null = null;
    let commissionAmount: number | null = null;
    if (orderTakerId) {
      const taker = await this.prisma.employee.findUnique({
        where: { id: orderTakerId },
        select: { fullName: true, commissionRate: true, isOrderTaker: true },
      });
      if (taker?.isOrderTaker) {
        orderTakerName = taker.fullName;
        commissionRate = Number(taker.commissionRate ?? 10);
        commissionAmount = parseFloat((subtotal * commissionRate / 100).toFixed(2));
      }
    }

    const order = await this.prisma.posOrder.create({
      data: {
        tenantId,
        branchId,
        tableId,
        customerId,
        createdById: userId,
        servedById: servedById || userId,
        orderNumber,
        orderType: orderType || 'DINE_IN',
        status: 'PENDING',
        source: source || 'POS',
        subtotal: rawSubtotal,
        discountAmount,
        taxAmount,
        total,
        orderTakerId: orderTakerId || null,
        orderTakerName,
        commissionRate,
        commissionAmount,
        needsPackaging: data.needsPackaging || false,
        notes: discountNotes ? `${notes || ''}${notes ? ' | ' : ''}Discount: ${discountNotes}` : notes,
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

    // Update table status with time tracking
    if (tableId) {
      const server = servedById ? await this.prisma.user.findUnique({ where: { id: servedById }, select: { fullName: true } }) : null;
      await this.prisma.restaurantTable.update({
        where: { id: tableId },
        data: {
          status: 'OCCUPIED',
          occupiedSince: new Date(),
          currentOrderId: order.id,
          servedBy: server?.fullName || null,
        },
      });
    }

    // Emit event for KDS
    this.eventEmitter.emit('order.created', order);

    return order;
  }

  async getOrders(tenantId: string, branchId: string, filters: any = {}) {
    const { status, orderType, date } = filters;
    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const limit = Math.min(100, parseInt(filters.limit, 10) || 50);
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
        orderItems: { include: { modifiers: true, menuItem: { select: { name: true, image: true, itemType: true } } } },
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
        data: { status: 'AVAILABLE', occupiedSince: null, currentOrderId: null, servedBy: null },
      });
    }

    this.eventEmitter.emit('order.statusChanged', { orderId: id, status });
    return updated;
  }

  // ─── Payments ────────────────────────────────────────────────────────────────

  async processPayment(
    tenantId: string,
    orderId: string,
    payments: any[],
    customerLeft = true,
    paymentMethod?: string,
    customerInfo?: { fullName?: string; phone?: string; email?: string; optInEmail?: boolean },
  ) {
    let order = await this.getOrder(tenantId, orderId);

    // Capture customer at payment for marketing — upsert by phone if provided
    if (customerInfo && (customerInfo.phone || customerInfo.email) && customerInfo.fullName) {
      let customer: any = null;
      if (customerInfo.phone) {
        customer = await this.prisma.customer.findFirst({
          where: { tenantId, phone: customerInfo.phone },
        });
      }
      if (!customer && customerInfo.email) {
        customer = await this.prisma.customer.findFirst({
          where: { tenantId, email: customerInfo.email },
        });
      }
      if (customer) {
        customer = await this.prisma.customer.update({
          where: { id: customer.id },
          data: {
            fullName: customerInfo.fullName,
            email: customerInfo.email || customer.email,
            phone: customerInfo.phone || customer.phone,
            optInEmail: customerInfo.optInEmail ?? customer.optInEmail,
          },
        });
      } else {
        customer = await this.prisma.customer.create({
          data: {
            tenantId,
            fullName: customerInfo.fullName,
            email: customerInfo.email,
            phone: customerInfo.phone,
            optInEmail: !!customerInfo.optInEmail,
            source: 'WALK_IN',
          },
        });
      }
      await this.prisma.posOrder.update({
        where: { id: orderId },
        data: { customerId: customer.id },
      });
      order = await this.getOrder(tenantId, orderId);
    }

    // Recalculate tax based on the actual payment method picked at checkout
    // (the order may have been created earlier with a default rate)
    if (paymentMethod) {
      const newRate = paymentMethod === 'CASH' ? 16 : 5;
      const currentRate = Number(order.orderItems?.[0]?.taxRate ?? 0);
      if (Math.abs(currentRate - newRate) > 0.01) {
        await this.prisma.$transaction(async (tx) => {
          let newSubtotal = 0;
          let newTax = 0;
          for (const item of order.orderItems) {
            const lineSub = Number(item.unitPrice) * item.quantity;
            const lineTax = (lineSub * newRate) / 100;
            newSubtotal += lineSub;
            newTax += lineTax;
            await tx.posOrderItem.update({
              where: { id: item.id },
              data: { taxRate: newRate, taxAmount: lineTax, lineTotal: lineSub + lineTax },
            });
          }
          await tx.posOrder.update({
            where: { id: orderId },
            data: { subtotal: newSubtotal, taxAmount: newTax, total: newSubtotal + newTax },
          });
        });
        order = await this.getOrder(tenantId, orderId);
      }
    }

    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
    if (totalPaid < Number(order.total)) {
      throw new BadRequestException(
        `Payment of ${totalPaid} is less than order total ${order.total}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.posPayment.createMany({
        data: payments.map(p => ({
          orderId,
          method: p.method,
          amount: p.amount,
          reference: p.reference,
          status: 'COMPLETED',
        })),
      });

      await tx.posOrder.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      // Free the table only if customer has left
      if (order.tableId && customerLeft) {
        await tx.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: 'AVAILABLE', occupiedSince: null, currentOrderId: null, servedBy: null },
        });
      }

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

  // ─── Order Taker Commission ───────────────────────────────────────────────────

  async getCommissionSummary(tenantId: string, branchId?: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const dayStart = new Date(targetDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate); dayEnd.setHours(23, 59, 59, 999);

    const orders = await this.prisma.posOrder.findMany({
      where: {
        tenantId,
        ...(branchId && { branchId }),
        status: 'COMPLETED',
        orderTakerId: { not: null },
        completedAt: { gte: dayStart, lte: dayEnd },
      },
      select: {
        id: true, orderNumber: true, subtotal: true, total: true,
        orderTakerId: true, orderTakerName: true, commissionRate: true, commissionAmount: true,
        completedAt: true, orderType: true,
      },
    });

    // Group by order taker
    const takerMap: Record<string, { name: string; rate: number; orders: number; subtotal: number; commission: number; items: any[] }> = {};
    for (const o of orders) {
      const key = o.orderTakerId!;
      if (!takerMap[key]) {
        takerMap[key] = { name: o.orderTakerName || 'Unknown', rate: Number(o.commissionRate || 10), orders: 0, subtotal: 0, commission: 0, items: [] };
      }
      takerMap[key].orders += 1;
      takerMap[key].subtotal += Number(o.subtotal);
      takerMap[key].commission += Number(o.commissionAmount || 0);
      takerMap[key].items.push({ orderNumber: o.orderNumber, subtotal: Number(o.subtotal), commission: Number(o.commissionAmount), type: o.orderType });
    }

    const takers = Object.entries(takerMap).map(([id, data]) => ({ orderTakerId: id, ...data }));
    const totalCommission = takers.reduce((s, t) => s + t.commission, 0);

    return { date: targetDate.toISOString().slice(0, 10), takers, totalCommission, totalOrders: orders.length };
  }

  async getOrderTakers(tenantId: string) {
    return this.prisma.employee.findMany({
      where: { tenantId, isOrderTaker: true, isActive: true },
      select: { id: true, fullName: true, employeeCode: true, commissionRate: true },
      orderBy: { fullName: 'asc' },
    });
  }

  // ─── Void System ─────────────────────────────────────────────────────────────

  static readonly VOID_REASONS = [
    'Customer left without paying',
    'Customer changed mind',
    'Wrong order punched',
    'Item out of stock',
    'Duplicate order',
    'Other',
  ];

  /**
   * Request or execute a void.
   * - TENANT_OWNER: instant void, no approval needed
   * - MANAGER: instant void for pending orders within same day
   * - CASHIER/WAITER: creates a void REQUEST that needs approval
   */
  async requestVoid(tenantId: string, userId: string, userRole: string, data: {
    orderId: string; orderItemId?: string; reason: string;
  }) {
    const order = await this.getOrder(tenantId, data.orderId);
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
      throw new BadRequestException('Order is already cancelled/refunded');
    }

    const isOwner = userRole === 'TENANT_OWNER';
    const isManager = userRole === 'MANAGER';
    const type = data.orderItemId ? 'PARTIAL_VOID' : 'FULL_VOID';

    // Owner: instant void, no limits
    if (isOwner) {
      return this.executeVoid(tenantId, data.orderId, data.orderItemId, data.reason, userId);
    }

    // Manager: instant void for pending/today orders
    if (isManager) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const orderDate = new Date(order.createdAt); orderDate.setHours(0, 0, 0, 0);
      if (orderDate >= today && ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(order.status)) {
        return this.executeVoid(tenantId, data.orderId, data.orderItemId, data.reason, userId);
      }
    }

    // Cashier/Waiter or Manager for old/completed orders: create request
    const request = await this.prisma.voidRequest.create({
      data: {
        tenantId,
        orderId: data.orderId,
        orderItemId: data.orderItemId || null,
        type,
        reason: data.reason,
        requestedById: userId,
        status: 'PENDING',
      },
      include: {
        order: { select: { orderNumber: true, total: true } },
        requestedBy: { select: { fullName: true } },
      },
    });

    // Mark order as void requested
    if (type === 'FULL_VOID') {
      await this.prisma.posOrder.update({
        where: { id: data.orderId },
        data: { status: 'VOID_REQUESTED' },
      });
    }

    return { request, message: 'Void request submitted for approval' };
  }

  async executeVoid(tenantId: string, orderId: string, orderItemId: string | null | undefined, reason: string, userId: string) {
    if (orderItemId) {
      // Partial void — remove single item
      return this.executePartialVoid(tenantId, orderId, orderItemId, reason, userId);
    }

    // Full void
    const order = await this.getOrder(tenantId, orderId);

    await this.prisma.$transaction(async (tx) => {
      await tx.posOrder.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: reason,
        },
      });

      // Free the table if occupied
      if (order.tableId) {
        await tx.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: 'AVAILABLE', occupiedSince: null, currentOrderId: null, servedBy: null },
        });
      }
    });

    return { message: `Order ${order.orderNumber} voided — ${reason}`, voided: true };
  }

  async executePartialVoid(tenantId: string, orderId: string, orderItemId: string, reason: string, userId: string) {
    const order = await this.getOrder(tenantId, orderId);
    const item = order.orderItems.find((i: any) => i.id === orderItemId);
    if (!item) throw new NotFoundException('Order item not found');

    await this.prisma.$transaction(async (tx) => {
      // Remove the item
      await tx.posOrderItem.delete({ where: { id: orderItemId } });

      // Recalculate order totals
      const remaining = await tx.posOrderItem.findMany({ where: { orderId } });
      if (remaining.length === 0) {
        // All items removed — void entire order
        await tx.posOrder.update({
          where: { id: orderId },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `All items voided — ${reason}`, subtotal: 0, taxAmount: 0, total: 0 },
        });
        if (order.tableId) {
          await tx.restaurantTable.update({
            where: { id: order.tableId },
            data: { status: 'AVAILABLE', occupiedSince: null, currentOrderId: null, servedBy: null },
          });
        }
      } else {
        const newSubtotal = remaining.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
        const taxRate = Number(remaining[0]?.taxRate ?? 0);
        const newTax = parseFloat(((newSubtotal * taxRate) / 100).toFixed(2));
        const newTotal = parseFloat((newSubtotal + newTax).toFixed(2));
        await tx.posOrder.update({
          where: { id: orderId },
          data: { subtotal: newSubtotal, taxAmount: newTax, total: newTotal, notes: `Item voided: ${item.itemName} — ${reason}` },
        });
      }
    });

    return { message: `${item.itemName} removed from order — ${reason}`, voided: true };
  }

  async getVoidRequests(tenantId: string, status?: string) {
    return this.prisma.voidRequest.findMany({
      where: { tenantId, ...(status && { status }) },
      include: {
        order: { select: { orderNumber: true, total: true, status: true, orderItems: true } },
        requestedBy: { select: { fullName: true, role: true } },
        approvedBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveVoidRequest(tenantId: string, requestId: string, userId: string) {
    const req = await this.prisma.voidRequest.findUnique({ where: { id: requestId } });
    if (!req || req.status !== 'PENDING') throw new BadRequestException('Request not found or already processed');

    // Execute the void
    await this.executeVoid(tenantId, req.orderId, req.orderItemId, req.reason, userId);

    return this.prisma.voidRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED', approvedById: userId, processedAt: new Date() },
    });
  }

  async rejectVoidRequest(requestId: string, userId: string, rejectionNote?: string) {
    const req = await this.prisma.voidRequest.findUnique({
      where: { id: requestId },
      include: { order: { select: { status: true } } },
    });
    if (!req || req.status !== 'PENDING') throw new BadRequestException('Request not found or already processed');

    // Restore order status if it was marked as VOID_REQUESTED
    if (req.order?.status === 'VOID_REQUESTED') {
      await this.prisma.posOrder.update({
        where: { id: req.orderId },
        data: { status: 'PENDING' },
      });
    }

    return this.prisma.voidRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', approvedById: userId, rejectionNote, processedAt: new Date() },
    });
  }

  // ─── Tables ──────────────────────────────────────────────────────────────────

  async getTables(branchId: string) {
    return this.prisma.restaurantTable.findMany({
      where: { branchId, isActive: true },
      include: {
        posOrders: {
          where: { status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] } },
          include: { orderItems: true, payments: true, createdBy: { select: { fullName: true } } },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        reservations: {
          where: { status: 'CONFIRMED', date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
          take: 1,
          orderBy: { date: 'asc' },
        },
      },
      orderBy: [{ section: 'asc' }, { number: 'asc' }],
    });
  }

  async createTable(branchId: string, data: any) {
    return this.prisma.restaurantTable.create({ data: { branchId, ...data } });
  }

  async setTableCleaning(branchId: string, tableId: string) {
    await this.prisma.restaurantTable.update({
      where: { id: tableId },
      data: { status: 'CLEANING', currentOrderId: null, servedBy: null },
    });
    // Auto-release after 5 minutes
    setTimeout(async () => {
      try {
        const table = await this.prisma.restaurantTable.findUnique({ where: { id: tableId } });
        if (table?.status === 'CLEANING') {
          await this.prisma.restaurantTable.update({
            where: { id: tableId },
            data: { status: 'AVAILABLE', occupiedSince: null },
          });
        }
      } catch {}
    }, 5 * 60 * 1000);
    return { status: 'CLEANING' };
  }

  async updateTableStatus(branchId: string, tableId: string, status: string) {
    const data: any = { status: status as any };
    if (status === 'AVAILABLE') {
      data.occupiedSince = null;
      data.currentOrderId = null;
      data.servedBy = null;
    }
    return this.prisma.restaurantTable.updateMany({
      where: { id: tableId, branchId },
      data: { status: status as any },
    });
  }

  // ─── KDS / Bar ───────────────────────────────────────────────────────────────

  async getKdsTickets(branchId: string, stationType?: string) {
    return this.prisma.kitchenTicket.findMany({
      where: {
        order: { branchId },
        status: { in: ['PENDING', 'IN_PROGRESS', 'READY'] },
        ...(stationType && { station: { type: stationType as any } }),
      },
      include: {
        station: true,
        order: { select: { orderNumber: true, orderType: true, table: true, createdAt: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async bumpTicket(ticketId: string, status: string) {
    return this.prisma.kitchenTicket.update({
      where: { id: ticketId },
      data: {
        status: status as any,
        ...(status === 'IN_PROGRESS' && { startedAt: new Date() }),
        ...(status === 'READY' && { completedAt: new Date() }),
        ...(status === 'BUMPED' && { bumpedAt: new Date() }),
      },
      include: { station: true, order: { select: { orderNumber: true, orderType: true, table: true } } },
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
