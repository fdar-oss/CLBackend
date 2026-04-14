import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

// Convenience decorators
export const OwnerOnly = () => Roles(UserRole.TENANT_OWNER);
export const ManagerAndAbove = () => Roles(UserRole.TENANT_OWNER, UserRole.MANAGER);
export const CashierAndAbove = () => Roles(
  UserRole.TENANT_OWNER,
  UserRole.MANAGER,
  UserRole.CASHIER,
);
