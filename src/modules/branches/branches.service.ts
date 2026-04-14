import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/create-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateBranchDto) {
    const exists = await this.prisma.branch.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (exists) throw new ConflictException(`Branch code "${dto.code}" already exists`);

    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({ data: { tenantId, ...dto } });

      // Create default stock location for new branch
      await tx.stockLocation.create({
        data: { branchId: branch.id, name: 'Main Store', isDefault: true },
      });

      // Create default kitchen station
      await tx.kitchenStation.create({
        data: { branchId: branch.id, name: 'Kitchen', type: 'KITCHEN' },
      });

      return branch;
    });
  }

  findAll(tenantId: string) {
    return this.prisma.branch.findMany({
      where: { tenantId, isActive: true },
      include: {
        _count: { select: { users: true, posOrders: true, employees: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, tenantId },
      include: {
        stockLocations: true,
        kitchenStations: true,
        _count: { select: { tables: true, employees: true } },
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async update(tenantId: string, id: string, dto: UpdateBranchDto) {
    await this.findOne(tenantId, id);
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async deactivate(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.branch.update({ where: { id }, data: { isActive: false } });
  }
}
