import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CrmService {
  constructor(private prisma: PrismaService) {}

  // ─── Customers ────────────────────────────────────────────────────────────────

  async createCustomer(tenantId: string, data: any) {
    if (data.phone) {
      const exists = await this.prisma.customer.findFirst({
        where: { tenantId, phone: data.phone },
      });
      if (exists) return exists; // return existing instead of throwing
    }

    const customer = await this.prisma.customer.create({
      data: { tenantId, ...data },
    });

    // Enroll in loyalty program if exists
    const program = await this.prisma.loyaltyProgram.findUnique({ where: { tenantId } });
    if (program?.isActive) {
      const defaultTier = await this.prisma.loyaltyTier.findFirst({
        where: { programId: program.id },
        orderBy: { minPoints: 'asc' },
      });
      await this.prisma.loyaltyAccount.create({
        data: {
          programId: program.id,
          customerId: customer.id,
          tierId: defaultTier?.id,
        },
      });
    }

    return customer;
  }

  async getCustomers(tenantId: string, filters: any = {}) {
    const { search, page = 1, limit = 50 } = filters;
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(search && {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      include: { loyaltyAccount: { include: { tier: true } } },
      orderBy: { lastVisitAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async getCustomer(tenantId: string, id: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        loyaltyAccount: { include: { tier: true, transactions: { take: 10, orderBy: { createdAt: 'desc' } } } },
        posOrders: { take: 10, orderBy: { createdAt: 'desc' }, include: { payments: true } },
        reservations: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  async updateCustomer(tenantId: string, id: string, data: any) {
    await this.getCustomer(tenantId, id);
    return this.prisma.customer.update({ where: { id }, data });
  }

  // ─── Reservations ─────────────────────────────────────────────────────────────

  async createReservation(tenantId: string, data: any) {
    return this.prisma.reservation.create({
      data: { tenantId, ...data, date: new Date(data.date) },
      include: { branch: { select: { name: true } }, table: { select: { number: true } } },
    });
  }

  async getReservations(tenantId: string, filters: any = {}) {
    const { branchId, date, status } = filters;
    return this.prisma.reservation.findMany({
      where: {
        tenantId,
        ...(branchId && { branchId }),
        ...(status && { status }),
        ...(date && { date: new Date(date) }),
      },
      include: {
        branch: { select: { name: true } },
        table: { select: { number: true, section: true } },
        customer: { select: { fullName: true, phone: true } },
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });
  }

  async updateReservationStatus(tenantId: string, id: string, status: string, tableId?: string) {
    return this.prisma.reservation.update({
      where: { id },
      data: {
        status: status as any,
        ...(tableId && { tableId }),
        ...(status === 'CONFIRMED' && { confirmedAt: new Date() }),
        ...(status === 'SEATED' && { seatedAt: new Date() }),
        ...(status === 'CANCELLED' && { cancelledAt: new Date() }),
      },
    });
  }

  // ─── Feedback & Complaints ────────────────────────────────────────────────────

  async submitFeedback(data: any) {
    return this.prisma.customerFeedback.create({ data });
  }

  async getFeedback(tenantId: string, filters: any = {}) {
    return this.prisma.customerFeedback.findMany({
      where: { tenantId, ...(filters.branchId && { branchId: filters.branchId }) },
      include: { customer: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createComplaint(data: any) {
    return this.prisma.customerComplaint.create({ data });
  }

  async getComplaints(tenantId: string, filters: any = {}) {
    return this.prisma.customerComplaint.findMany({
      where: {
        tenantId,
        ...(filters.status && { status: filters.status }),
      },
      include: { customer: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveComplaint(id: string, resolution: string) {
    return this.prisma.customerComplaint.update({
      where: { id },
      data: { status: 'RESOLVED', resolution, resolvedAt: new Date() },
    });
  }

  // ─── Loyalty ──────────────────────────────────────────────────────────────────

  async getLoyaltyProgram(tenantId: string) {
    return this.prisma.loyaltyProgram.findUnique({
      where: { tenantId },
      include: { tiers: { orderBy: { minPoints: 'asc' } } },
    });
  }

  async updateLoyaltyProgram(tenantId: string, data: any) {
    return this.prisma.loyaltyProgram.update({ where: { tenantId }, data });
  }

  async getLoyaltyAccount(customerId: string) {
    return this.prisma.loyaltyAccount.findUnique({
      where: { customerId },
      include: {
        tier: true,
        transactions: { take: 20, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async redeemPoints(customerId: string, points: number, orderId: string) {
    const account = await this.prisma.loyaltyAccount.findUnique({ where: { customerId } });
    if (!account) throw new NotFoundException('Loyalty account not found');
    if (account.points < points) throw new ConflictException('Insufficient loyalty points');

    return this.prisma.$transaction(async (tx) => {
      await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: { points: { decrement: points } },
      });
      return tx.loyaltyTransaction.create({
        data: {
          accountId: account.id,
          points: -points,
          type: 'REDEEMED',
          reference: orderId,
          description: 'Points redeemed at POS',
        },
      });
    });
  }
}
