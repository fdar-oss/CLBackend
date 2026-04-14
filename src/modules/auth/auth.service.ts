import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { LoginDto, ChangePasswordDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async login(dto: LoginDto, ipAddress?: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email.toLowerCase().trim(),
        isActive: true,
      },
      include: {
        tenant: { select: { id: true, name: true, status: true, slug: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    if (!user) throw new UnauthorizedException('Invalid email or password');

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) throw new UnauthorizedException('Invalid email or password');

    if (user.tenant.status === 'SUSPENDED') {
      throw new UnauthorizedException('Your account has been suspended. Contact support.');
    }
    if (user.tenant.status === 'CANCELLED') {
      throw new UnauthorizedException('This subscription has been cancelled.');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      branchId: user.branchId,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(payload),
      this.generateRefreshToken(payload, dto.deviceInfo, ipAddress),
    ]);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        avatar: user.avatar,
        tenant: user.tenant,
        branch: user.branch,
      },
    };
  }

  async refreshTokens(userId: string, tenantId: string, rawRefreshToken: string) {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: rawRefreshToken },
      include: { user: true },
    });

    if (
      !storedToken ||
      storedToken.userId !== userId ||
      storedToken.revokedAt ||
      storedToken.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: revoke old, issue new
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    const payload: JwtPayload = {
      sub: storedToken.user.id,
      email: storedToken.user.email,
      tenantId: storedToken.user.tenantId,
      branchId: storedToken.user.branchId,
      role: storedToken.user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(payload),
      this.generateRefreshToken(payload),
    ]);

    return { accessToken, refreshToken };
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const hash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash },
    });

    // Revoke all refresh tokens on password change
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { message: 'Password changed successfully' };
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, fullName: true, role: true, avatar: true,
        phone: true, createdAt: true,
        tenant: { select: { id: true, name: true, slug: true, logo: true, primaryColor: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async generateAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.get('jwt.accessSecret'),
      expiresIn: this.config.get('jwt.accessExpiresIn'),
    });
  }

  private async generateRefreshToken(
    payload: JwtPayload,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<string> {
    const token = uuidv4();
    const expiresIn = this.config.get<string>('jwt.refreshExpiresIn');
    const days = parseInt(expiresIn || '') || 7;

    await this.prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        token,
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        deviceInfo,
        ipAddress,
      },
    });

    return token;
  }

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }
}
