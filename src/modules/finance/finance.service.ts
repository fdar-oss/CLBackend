import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  // ─── Expenses ─────────────────────────────────────────────────────────────────

  async createExpense(tenantId: string, userId: string, data: any) {
    return this.prisma.expense.create({
      data: { tenantId, createdById: userId, ...data, date: new Date(data.date) },
      include: { category: true, branch: { select: { name: true } } },
    });
  }

  async getExpenses(tenantId: string, filters: any = {}) {
    const { branchId, categoryId, from, to, status } = filters;
    return this.prisma.expense.findMany({
      where: {
        tenantId,
        ...(branchId && { branchId }),
        ...(categoryId && { categoryId }),
        ...(status && { status }),
        ...(from && to && { date: { gte: new Date(from), lte: new Date(to) } }),
      },
      include: { category: true, branch: { select: { name: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async approveExpense(id: string, userId: string) {
    return this.prisma.expense.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId },
    });
  }

  async getExpenseCategories(tenantId: string) {
    return this.prisma.expenseCategory.findMany({ where: { tenantId } });
  }

  async createExpenseCategory(tenantId: string, name: string) {
    return this.prisma.expenseCategory.create({ data: { tenantId, name } });
  }

  // ─── Daily Sales Summary ──────────────────────────────────────────────────────

  @OnEvent('shift.closed')
  async computeDailySummary(payload: { branchId: string; date: string }) {
    await this.buildDailySummary(payload.branchId, new Date(payload.date));
  }

  async buildDailySummary(branchId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const orders = await this.prisma.posOrder.findMany({
      where: { branchId, createdAt: { gte: startOfDay, lte: endOfDay }, status: 'COMPLETED' },
      include: { payments: true, refunds: true },
    });

    const summary = {
      totalOrders: orders.length,
      dineInOrders: orders.filter(o => o.orderType === 'DINE_IN').length,
      takeawayOrders: orders.filter(o => o.orderType === 'TAKEAWAY').length,
      deliveryOrders: orders.filter(o => o.orderType === 'DELIVERY').length,
      onlineOrders: orders.filter(o => o.orderType === 'ONLINE').length,
      grossSales: orders.reduce((s, o) => s + Number(o.total), 0),
      discounts: orders.reduce((s, o) => s + Number(o.discountAmount), 0),
      refunds: orders.reduce((s, o) => o.refunds.reduce((rs, r) => rs + Number(r.amount), 0), 0),
      taxCollected: orders.reduce((s, o) => s + Number(o.taxAmount), 0),
      cashSales: this.sumByMethod(orders, 'CASH'),
      cardSales: this.sumByMethod(orders, 'CARD'),
      onlineSales: this.sumByMethod(orders, ['JAZZCASH', 'EASYPAISA', 'ONLINE']),
    };
    summary['netSales'] = summary.grossSales - summary.discounts - summary.refunds;

    return this.prisma.dailySalesSummary.upsert({
      where: { branchId_date: { branchId, date: startOfDay } },
      update: summary,
      create: { branchId, date: startOfDay, ...summary },
    });
  }

  async getDailySummaries(tenantId: string, filters: any = {}) {
    const { branchId, from, to } = filters;
    return this.prisma.dailySalesSummary.findMany({
      where: {
        branch: { tenantId },
        ...(branchId && { branchId }),
        ...(from && to && { date: { gte: new Date(from), lte: new Date(to) } }),
      },
      include: { branch: { select: { name: true, code: true } } },
      orderBy: { date: 'desc' },
    });
  }

  // ─── End of Day Report ───────────────────────────────────────────────────────

  async getEODReport(tenantId: string, date: string, branchId?: string) {
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    const branchFilter = branchId ? { branchId } : {};

    // All orders for the day
    const allOrders = await this.prisma.posOrder.findMany({
      where: { tenantId, ...branchFilter, createdAt: { gte: dayStart, lte: dayEnd } },
      include: { payments: true, orderItems: true, createdBy: { select: { fullName: true } } },
    });

    const completed = allOrders.filter(o => o.status === 'COMPLETED');
    const cancelled = allOrders.filter(o => o.status === 'CANCELLED');
    const refunded = allOrders.filter(o => o.status === 'REFUNDED');

    // Sales summary
    const grossSales = completed.reduce((s, o) => s + Number(o.total), 0);
    const totalSubtotal = completed.reduce((s, o) => s + Number(o.subtotal), 0);
    const totalTax = completed.reduce((s, o) => s + Number(o.taxAmount), 0);
    const totalDiscount = completed.reduce((s, o) => s + Number(o.discountAmount || 0), 0);

    // Payment methods
    const allPayments = completed.flatMap(o => o.payments).filter(p => p.status === 'COMPLETED');
    const cashSales = allPayments.filter(p => p.method === 'CASH').reduce((s, p) => s + Number(p.amount), 0);
    const cardSales = allPayments.filter(p => p.method === 'CARD').reduce((s, p) => s + Number(p.amount), 0);
    const bankSales = allPayments.filter(p => p.method === 'BANK_TRANSFER').reduce((s, p) => s + Number(p.amount), 0);

    // Order types
    const dineIn = completed.filter(o => o.orderType === 'DINE_IN').length;
    const takeaway = completed.filter(o => o.orderType === 'TAKEAWAY').length;
    const delivery = completed.filter(o => o.orderType === 'DELIVERY').length;

    // Voids & refunds value
    const voidedValue = cancelled.reduce((s, o) => s + Number(o.total), 0);
    const refundedValue = refunded.reduce((s, o) => s + Number(o.total), 0);

    // Commission
    const commissionOrders = completed.filter(o => o.orderTakerId);
    const totalCommission = commissionOrders.reduce((s, o) => s + Number((o as any).commissionAmount || 0), 0);
    const commissionByTaker: Record<string, { name: string; orders: number; subtotal: number; commission: number }> = {};
    for (const o of commissionOrders) {
      const key = o.orderTakerId!;
      if (!commissionByTaker[key]) commissionByTaker[key] = { name: (o as any).orderTakerName || 'Unknown', orders: 0, subtotal: 0, commission: 0 };
      commissionByTaker[key].orders += 1;
      commissionByTaker[key].subtotal += Number(o.subtotal);
      commissionByTaker[key].commission += Number((o as any).commissionAmount || 0);
    }

    // Combined item breakdown
    const allItemMap: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const o of completed) {
      for (const item of o.orderItems) {
        const key = item.itemName;
        if (!allItemMap[key]) allItemMap[key] = { name: key, qty: 0, revenue: 0 };
        allItemMap[key].qty += item.quantity;
        allItemMap[key].revenue += Number(item.lineTotal);
      }
    }
    const allItems = Object.values(allItemMap).sort((a, b) => b.qty - a.qty);

    // Per-shift breakdown
    const shifts = await this.prisma.posShift.findMany({
      where: {
        ...branchFilter,
        OR: [
          { openedAt: { gte: dayStart, lte: dayEnd } },
          { closedAt: { gte: dayStart, lte: dayEnd } },
          { openedAt: { lte: dayStart }, closedAt: null }, // still open from before
          { openedAt: { lte: dayStart }, closedAt: { gte: dayEnd } }, // spans entire day
        ],
      },
      include: {
        openedBy: { select: { fullName: true } },
        closedBy: { select: { fullName: true } },
      },
      orderBy: { openedAt: 'asc' },
    });

    const shiftBreakdowns: any[] = [];
    for (const shift of shifts) {
      const shiftOrders = completed.filter(o => {
        const orderTime = new Date(o.createdAt);
        const shiftStart = new Date(shift.openedAt);
        const shiftEnd = shift.closedAt ? new Date(shift.closedAt) : dayEnd;
        return orderTime >= shiftStart && orderTime <= shiftEnd;
      });

      const shiftItemMap: Record<string, { name: string; qty: number; revenue: number }> = {};
      for (const o of shiftOrders) {
        for (const item of o.orderItems) {
          const key = item.itemName;
          if (!shiftItemMap[key]) shiftItemMap[key] = { name: key, qty: 0, revenue: 0 };
          shiftItemMap[key].qty += item.quantity;
          shiftItemMap[key].revenue += Number(item.lineTotal);
        }
      }

      shiftBreakdowns.push({
        shiftId: shift.id,
        openedBy: shift.openedBy?.fullName || 'Unknown',
        closedBy: shift.closedBy?.fullName || null,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        status: shift.status,
        openingFloat: Number(shift.openingFloat),
        closingCash: shift.closingCash ? Number(shift.closingCash) : null,
        cashVariance: shift.cashVariance ? Number(shift.cashVariance) : null,
        totalOrders: shiftOrders.length,
        totalSales: shiftOrders.reduce((s, o) => s + Number(o.total), 0),
        items: Object.values(shiftItemMap).sort((a, b) => b.qty - a.qty),
      });
    }

    // Expenses
    const expenses = await this.prisma.expense.findMany({
      where: { tenantId, ...branchFilter, date: { gte: dayStart, lte: dayEnd }, status: 'APPROVED' },
      include: { category: true },
    });
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const expensesByCategory: Record<string, number> = {};
    for (const e of expenses) {
      const cat = e.category?.name || 'Uncategorized';
      expensesByCategory[cat] = (expensesByCategory[cat] || 0) + Number(e.amount);
    }

    return {
      date,
      branchId,
      sales: {
        totalOrders: completed.length,
        grossSales,
        subtotal: totalSubtotal,
        tax: totalTax,
        discounts: totalDiscount,
        netRevenue: grossSales,
        avgOrderValue: completed.length > 0 ? grossSales / completed.length : 0,
      },
      payments: { cash: cashSales, card: cardSales, bank: bankSales },
      orderTypes: { dineIn, takeaway, delivery },
      voidsAndRefunds: {
        voidedCount: cancelled.length, voidedValue,
        refundedCount: refunded.length, refundedValue,
      },
      commission: {
        total: totalCommission,
        byTaker: Object.values(commissionByTaker),
      },
      shifts: shiftBreakdowns,
      allItems,
      expenses: {
        total: totalExpenses,
        byCategory: Object.entries(expensesByCategory).map(([category, total]) => ({ category, total })),
        items: expenses.map(e => ({ description: e.description, amount: Number(e.amount), category: e.category?.name })),
      },
      dailyPL: {
        revenue: grossSales,
        expenses: totalExpenses,
        commission: totalCommission,
        netProfit: grossSales - totalExpenses - totalCommission,
      },
    };
  }

  // ─── Dashboard (real-time from orders) ───────────────────────────────────────

  async getDashboard(tenantId: string, branchId?: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const branchFilter = branchId ? { branchId } : {};

    // Today's completed orders
    const todayOrders = await this.prisma.posOrder.findMany({
      where: { tenantId, ...branchFilter, status: 'COMPLETED', completedAt: { gte: todayStart } },
      include: { payments: true, orderItems: true },
    });

    // Week orders
    const weekOrders = await this.prisma.posOrder.findMany({
      where: { tenantId, ...branchFilter, status: 'COMPLETED', completedAt: { gte: weekStart } },
      include: { payments: true },
    });

    // Today stats
    const todayRevenue = todayOrders.reduce((s, o) => s + Number(o.total), 0);
    const todayTax = todayOrders.reduce((s, o) => s + Number(o.taxAmount), 0);
    const todaySubtotal = todayOrders.reduce((s, o) => s + Number(o.subtotal), 0);
    const todayCash = todayOrders.flatMap(o => o.payments).filter(p => p.method === 'CASH').reduce((s, p) => s + Number(p.amount), 0);
    const todayCard = todayOrders.flatMap(o => o.payments).filter(p => p.method === 'CARD').reduce((s, p) => s + Number(p.amount), 0);
    const todayBank = todayOrders.flatMap(o => o.payments).filter(p => p.method === 'BANK_TRANSFER').reduce((s, p) => s + Number(p.amount), 0);
    const todayAvgOrder = todayOrders.length > 0 ? todayRevenue / todayOrders.length : 0;

    // Week stats
    const weekRevenue = weekOrders.reduce((s, o) => s + Number(o.total), 0);

    // Top selling items today
    const itemCounts: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const order of todayOrders) {
      for (const item of order.orderItems) {
        const key = item.itemName;
        if (!itemCounts[key]) itemCounts[key] = { name: key, qty: 0, revenue: 0 };
        itemCounts[key].qty += item.quantity;
        itemCounts[key].revenue += Number(item.lineTotal);
      }
    }
    const topSellers = Object.values(itemCounts).sort((a, b) => b.qty - a.qty).slice(0, 10);

    // Hourly breakdown today
    const hourly: { hour: string; orders: number; revenue: number }[] = [];
    for (let h = 0; h < 24; h++) {
      const hourOrders = todayOrders.filter(o => {
        const completed = new Date(o.completedAt!);
        return completed.getHours() === h;
      });
      if (hourOrders.length > 0 || h >= 8 && h <= 23) {
        hourly.push({
          hour: `${h.toString().padStart(2, '0')}:00`,
          orders: hourOrders.length,
          revenue: hourOrders.reduce((s, o) => s + Number(o.total), 0),
        });
      }
    }

    // Daily revenue for last 7 days
    const dailyRevenue: { date: string; revenue: number; orders: number }[] = [];
    for (let d = 6; d >= 0; d--) {
      const day = new Date(todayStart);
      day.setDate(day.getDate() - d);
      const nextDay = new Date(day);
      nextDay.setDate(nextDay.getDate() + 1);
      const dayOrders = weekOrders.filter(o => {
        const c = new Date(o.completedAt!);
        return c >= day && c < nextDay;
      });
      dailyRevenue.push({
        date: day.toISOString().slice(0, 10),
        revenue: dayOrders.reduce((s, o) => s + Number(o.total), 0),
        orders: dayOrders.length,
      });
    }

    // Order type breakdown today
    const dineIn = todayOrders.filter(o => o.orderType === 'DINE_IN').length;
    const takeaway = todayOrders.filter(o => o.orderType === 'TAKEAWAY').length;
    const delivery = todayOrders.filter(o => o.orderType === 'DELIVERY').length;

    // Pending orders right now
    const pendingCount = await this.prisma.posOrder.count({
      where: { tenantId, ...branchFilter, status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] } },
    });

    return {
      today: {
        revenue: todayRevenue,
        subtotal: todaySubtotal,
        tax: todayTax,
        orders: todayOrders.length,
        avgOrder: todayAvgOrder,
        cash: todayCash,
        card: todayCard,
        bank: todayBank,
      },
      week: {
        revenue: weekRevenue,
        orders: weekOrders.length,
      },
      topSellers,
      hourly: hourly.filter(h => parseInt(h.hour) >= 8),
      dailyRevenue,
      orderTypes: { dineIn, takeaway, delivery },
      pendingOrders: pendingCount,
    };
  }

  // ─── Reports ─────────────────────────────────────────────────────────────────

  async getSalesReport(tenantId: string, from: string, to: string, branchId?: string) {
    const summaries = await this.getDailySummaries(tenantId, { branchId, from, to });

    const totals = summaries.reduce((acc, s) => ({
      totalOrders: acc.totalOrders + s.totalOrders,
      grossSales: acc.grossSales + Number(s.grossSales),
      netSales: acc.netSales + Number(s.netSales),
      taxCollected: acc.taxCollected + Number(s.taxCollected),
      cashSales: acc.cashSales + Number(s.cashSales),
      cardSales: acc.cardSales + Number(s.cardSales),
      onlineSales: acc.onlineSales + Number(s.onlineSales),
      discounts: acc.discounts + Number(s.discounts),
      refunds: acc.refunds + Number(s.refunds),
    }), {
      totalOrders: 0, grossSales: 0, netSales: 0, taxCollected: 0,
      cashSales: 0, cardSales: 0, onlineSales: 0, discounts: 0, refunds: 0,
    });

    return { period: { from, to }, totals, daily: summaries };
  }

  async getProfitLoss(tenantId: string, from: string, to: string, branchId?: string) {
    const [salesData, expenses, cogsResult] = await Promise.all([
      this.getSalesReport(tenantId, from, to, branchId),
      this.getExpenses(tenantId, { branchId, from, to, status: 'APPROVED' }),
      this.computeCogs(tenantId, from, to, branchId),
    ]);

    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const grossProfit = salesData.totals.netSales - cogsResult;
    const netProfit = grossProfit - totalExpenses;

    return {
      period: { from, to },
      revenue: salesData.totals.netSales,
      cogs: cogsResult,
      grossProfit,
      expenses: totalExpenses,
      netProfit,
      expenseBreakdown: expenses,
      salesBreakdown: salesData,
    };
  }

  private async computeCogs(tenantId: string, from: string, to: string, branchId?: string): Promise<number> {
    // COGS = sum of (quantity_deducted * unit_cost) for all SALE_DEDUCTION movements in the period.
    // unit_cost on a stock movement is set at the time of the last GRN received for that item.
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        type: 'SALE_DEDUCTION',
        referenceType: 'POS_ORDER',
        createdAt: { gte: new Date(from), lte: new Date(to) },
        location: {
          branch: {
            tenantId,
            ...(branchId && { id: branchId }),
          },
        },
        unitCost: { not: null },
      },
      select: { quantity: true, unitCost: true },
    });

    return movements.reduce((sum, m) => {
      // quantity is negative for deductions — take absolute value
      return sum + Math.abs(Number(m.quantity)) * Number(m.unitCost);
    }, 0);
  }

  private sumByMethod(orders: any[], methods: string | string[]): number {
    const methodList = Array.isArray(methods) ? methods : [methods];
    return orders.reduce((s, o) => {
      return s + (o.payments || [])
        .filter((p: any) => methodList.includes(p.method) && p.status === 'COMPLETED')
        .reduce((ps: number, p: any) => ps + Number(p.amount), 0);
    }, 0);
  }
}
