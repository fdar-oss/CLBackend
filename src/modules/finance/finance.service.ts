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
