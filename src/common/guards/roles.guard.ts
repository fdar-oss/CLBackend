import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;

    if (!user) return false;

    // TENANT_OWNER bypasses all role checks within their tenant
    if (user.role === UserRole.TENANT_OWNER) return true;

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `This action requires one of: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
