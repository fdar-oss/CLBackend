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
}
