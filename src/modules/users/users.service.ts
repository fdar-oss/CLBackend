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

  // ─── Per-User Access Control ─────────────────────────────────────────────────

  async getUserPermissions(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, email: true } });
    if (!user) return null;

    // The main admin account (first TENANT_OWNER) always gets full access
    if (user.role === 'TENANT_OWNER') {
      // Check if this is THE admin — we check by seeing if they have a permission record
      // If no record exists for an owner, they get full access by default
      const record = await this.prisma.userPermission.findUnique({ where: { userId } });
      if (!record) {
        return { userId, allowedRoutes: UsersService.ALL_ROUTES, allowedFeatures: UsersService.ALL_FEATURES };
      }
      return { userId, allowedRoutes: record.allowedRoutes, allowedFeatures: record.allowedFeatures };
    }

    const record = await this.prisma.userPermission.findUnique({ where: { userId } });
    return {
      userId,
      allowedRoutes: record?.allowedRoutes ?? [],
      allowedFeatures: record?.allowedFeatures ?? [],
    };
  }

  async getAllUserPermissions(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, fullName: true, email: true, role: true },
      orderBy: { fullName: 'asc' },
    });

    const permissions = await this.prisma.userPermission.findMany({
      where: { userId: { in: users.map(u => u.id) } },
    });
    const permMap = new Map(permissions.map(p => [p.userId, p]));

    return {
      users: users.map(u => {
        const perm = permMap.get(u.id);
        const isMainAdmin = u.role === 'TENANT_OWNER' && !perm;
        return {
          ...u,
          allowedRoutes: isMainAdmin ? UsersService.ALL_ROUTES : (perm?.allowedRoutes ?? []),
          allowedFeatures: isMainAdmin ? UsersService.ALL_FEATURES : (perm?.allowedFeatures ?? []),
          isMainAdmin,
        };
      }),
      allRoutes: UsersService.ALL_ROUTES,
      allFeatures: UsersService.ALL_FEATURES,
    };
  }

  async updateUserPermissions(userId: string, allowedRoutes: string[], allowedFeatures: string[]) {
    return this.prisma.userPermission.upsert({
      where: { userId },
      update: { allowedRoutes, allowedFeatures },
      create: { userId, tenantId: (await this.prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } }))!.tenantId, allowedRoutes, allowedFeatures },
    });
  }

  // Keep old method for backward compat
  async getPermissions(tenantId: string, role: string, userId?: string) {
    if (userId) return this.getUserPermissions(userId);
    if (role === 'TENANT_OWNER') {
      return { role, allowedRoutes: UsersService.ALL_ROUTES, allowedFeatures: UsersService.ALL_FEATURES };
    }
    return { role, allowedRoutes: [] as string[], allowedFeatures: [] as string[] };
  }

  async getAllPermissions(tenantId: string) {
    return this.getAllUserPermissions(tenantId);
  }

  async updatePermissions(tenantId: string, role: string, allowedRoutes: string[], allowedFeatures: string[]) {
    // This is now unused — kept for backward compat
    return { role, allowedRoutes, allowedFeatures };
  }
}
