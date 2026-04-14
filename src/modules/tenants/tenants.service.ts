import {
  Injectable, ConflictException, NotFoundException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/create-tenant.dto';
import { AuthService } from '../auth/auth.service';
import { PlanType } from '@prisma/client';

const PLAN_FEES: Record<PlanType, number> = {
  STARTER: 9999,
  GROWTH: 24999,
  PRO: 49999,
  ENTERPRISE: 99999,
};

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTenantDto) {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Slug "${dto.slug}" is already taken`);

    const plan = dto.plan || PlanType.STARTER;

    const tenant = await this.prisma.$transaction(async (tx) => {
      // 1. Create tenant
      const t = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          phone: dto.phone,
          status: 'TRIAL',
        },
      });

      // 2. Create 30-day trial subscription
      const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await tx.subscription.create({
        data: {
          tenantId: t.id,
          plan,
          status: 'TRIAL',
          monthlyFee: PLAN_FEES[plan],
          startDate: new Date(),
          trialEndsAt: trialEnd,
        },
      });

      // 3. Create default branch
      const branch = await tx.branch.create({
        data: {
          tenantId: t.id,
          name: dto.name,
          code: 'BR-01',
        },
      });

      // 4. Create owner user
      const passwordHash = await AuthService.hashPassword(dto.ownerPassword);
      await tx.user.create({
        data: {
          tenantId: t.id,
          branchId: null,
          email: dto.ownerEmail.toLowerCase().trim(),
          fullName: dto.ownerName,
          passwordHash,
          role: 'TENANT_OWNER',
        },
      });

      // 5. Seed default tax categories (Pakistan)
      await tx.taxCategory.createMany({
        data: [
          { tenantId: t.id, name: 'Standard GST 16%', rate: 16, isInclusive: false },
          { tenantId: t.id, name: 'Reduced Rate 5%', rate: 5, isInclusive: false },
          { tenantId: t.id, name: 'Tax Exempt', rate: 0, isInclusive: false },
        ],
      });

      // 6. Seed default expense categories
      await tx.expenseCategory.createMany({
        data: [
          { tenantId: t.id, name: 'Utilities' },
          { tenantId: t.id, name: 'Rent' },
          { tenantId: t.id, name: 'Maintenance' },
          { tenantId: t.id, name: 'Marketing' },
          { tenantId: t.id, name: 'Miscellaneous' },
        ],
      });

      // 7. Seed default loyalty program
      await tx.loyaltyProgram.create({
        data: {
          tenantId: t.id,
          name: `${dto.name} Rewards`,
          pointsPerPkr: 1,
          pkrPerPoint: 1,
          minRedemption: 100,
          tiers: {
            create: [
              { name: 'Bronze', minPoints: 0, multiplier: 1.0, color: '#CD7F32' },
              { name: 'Silver', minPoints: 1000, multiplier: 1.25, color: '#C0C0C0' },
              { name: 'Gold', minPoints: 5000, multiplier: 1.5, color: '#FFD700' },
              { name: 'Platinum', minPoints: 15000, multiplier: 2.0, color: '#E5E4E2' },
            ],
          },
        },
      });

      return { tenant: t, branch };
    });

    this.logger.log(`Tenant created: ${tenant.tenant.slug} (${tenant.tenant.id})`);
    return tenant;
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        skip,
        take: limit,
        include: { subscription: true, _count: { select: { branches: true, users: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count(),
    ]);
    return { data: tenants, total, page, limit };
  }

  async findBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: {
        subscription: true,
        branches: { where: { isActive: true } },
        _count: { select: { users: true, customers: true } },
      },
    });
    if (!tenant) throw new NotFoundException(`Tenant "${slug}" not found`);
    return tenant;
  }

  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { subscription: true, branches: { where: { isActive: true } } },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.findById(id);
    return this.prisma.tenant.update({ where: { id }, data: dto });
  }

  async suspend(id: string) {
    return this.prisma.tenant.update({ where: { id }, data: { status: 'SUSPENDED' } });
  }

  async activate(id: string) {
    return this.prisma.tenant.update({ where: { id }, data: { status: 'ACTIVE' } });
  }
}
