import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  tenantId: string;
  branchId: string | null;
  role: UserRole;
  iat?: number;
  exp?: number;
}
