import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email.toLowerCase() } },
    });
    if (exists) throw new ConflictException('A user with this email already exists');

    const passwordHash = await AuthService.hashPassword(dto.password);
    return this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email.toLowerCase().trim(),
        fullName: dto.fullName,
        passwordHash,
        role: dto.role,
        phone: dto.phone,
        branchId: dto.branchId || null,
      },
      select: {
        id: true, email: true, fullName: true, role: true,
        phone: true, avatar: true, isActive: true, createdAt: true,
        branch: { select: { id: true, name: true } },
      },
    });
  }

  findAll(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true, email: true, fullName: true, role: true,
        phone: true, avatar: true, isActive: true, lastLoginAt: true,
        branch: { select: { id: true, name: true } },
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true, email: true, fullName: true, role: true,
        phone: true, avatar: true, isActive: true, createdAt: true,
        branch: { select: { id: true, name: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(tenantId: string, id: string, dto: UpdateUserDto) {
    await this.findOne(tenantId, id);
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: {
        id: true, email: true, fullName: true, role: true,
        phone: true, avatar: true, isActive: true,
      },
    });
  }

  async deactivate(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ─── Access Control ─────────────────────────────────────────────────────────

  // All routes and features that can be controlled
  static readonly ALL_ROUTES = [
    '/admin/dashboard', '/admin/orders', '/admin/menu', '/admin/inventory',
    '/admin/procurement', '/admin/hr', '/admin/crm', '/admin/marketing',
    '/admin/finance', '/admin/reports', '/admin/fbr', '/admin/branches', '/admin/users',
    '/pos', '/pos/terminal', '/pos/tables', '/pos/kds', '/pos/bar',
  ];

  static readonly ALL_FEATURES = [
    'menu.delete', 'menu.toggle', 'menu.recipes', 'menu.variants',
    'orders.void', 'orders.refund', 'orders.reprint',
    'pos.discount', 'pos.send_order', 'pos.charge',
    'inventory.cost_analysis', 'inventory.packaging_rules',
    'finance.pl', 'finance.expenses_approve',
    'hr.scheduling', 'hr.payroll', 'hr.labor_cost',
    'reports.z_reports', 'reports.sales',
    'users.manage', 'users.access_control',
  ];

  // No defaults — admin configures everything manually via Access Control page
  // TENANT_OWNER always gets full access (hardcoded, cannot be changed)
  private static DEFAULTS: Record<string, { routes: string[]; features: string[] }> = {
    TENANT_OWNER: {
      routes: [...UsersService.ALL_ROUTES],
      features: [...UsersService.ALL_FEATURES],
    },
  };

  async getPermissions(tenantId: string, role: string) {
    // TENANT_OWNER always gets full access
    if (role === 'TENANT_OWNER') {
      return { role, allowedRoutes: UsersService.ALL_ROUTES, allowedFeatures: UsersService.ALL_FEATURES };
    }

    const record = await this.prisma.rolePermission.findUnique({
      where: { tenantId_role: { tenantId, role: role as any } },
    });

    if (record) {
      return { role, allowedRoutes: record.allowedRoutes, allowedFeatures: record.allowedFeatures };
    }

    // Fallback to defaults
    const defaults = UsersService.DEFAULTS[role] || { routes: [], features: [] };
    return { role, allowedRoutes: defaults.routes, allowedFeatures: defaults.features };
  }

  async getAllPermissions(tenantId: string) {
    const roles = ['TENANT_OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'CHEF', 'INVENTORY_STAFF', 'HR_MANAGER', 'FINANCE_MANAGER', 'MARKETING_MANAGER'];
    const result: any[] = [];

    for (const role of roles) {
      const perm = await this.getPermissions(tenantId, role);
      result.push(perm);
    }

    return {
      roles: result,
      allRoutes: UsersService.ALL_ROUTES,
      allFeatures: UsersService.ALL_FEATURES,
    };
  }

  async updatePermissions(tenantId: string, role: string, allowedRoutes: string[], allowedFeatures: string[]) {
    // Cannot modify TENANT_OWNER permissions
    if (role === 'TENANT_OWNER') return this.getPermissions(tenantId, role);

    return this.prisma.rolePermission.upsert({
      where: { tenantId_role: { tenantId, role: role as any } },
      update: { allowedRoutes, allowedFeatures },
      create: { tenantId, role: role as any, allowedRoutes, allowedFeatures },
    });
  }
}
