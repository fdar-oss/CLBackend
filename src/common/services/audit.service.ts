import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(data: {
    tenantId: string;
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    oldValues?: any;
    newValues?: any;
    ipAddress?: string;
    userAgent?: string;
  }) {
    try {
      await this.prisma.auditLog.create({ data });
    } catch {
      // Silently fail — audit should never break the app
    }
  }

  async getLogs(tenantId: string, filters: any = {}) {
    const { userId, resource, action, from, to, page = 1, limit = 50 } = filters;
    const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * (parseInt(limit, 10) || 50);
    const take = Math.min(100, parseInt(limit, 10) || 50);

    const where: any = {
      tenantId,
      ...(userId && { userId }),
      ...(resource && { resource }),
      ...(action && { action }),
      ...(from && to && { createdAt: { gte: new Date(from), lte: new Date(to) } }),
    };

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { fullName: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total, page: parseInt(page, 10) || 1, limit: take };
  }
}
