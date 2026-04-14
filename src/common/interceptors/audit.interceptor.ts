import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    // Only audit mutating operations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const user = request.user;
    if (!user?.tenantId) return next.handle();

    return next.handle().pipe(
      tap(() => {
        // Fire-and-forget audit log
        this.prisma.auditLog.create({
          data: {
            tenantId: user.tenantId,
            userId: user.sub,
            action: method,
            resource: request.path.split('/').filter(Boolean).pop() || 'unknown',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          },
        }).catch(() => {/* swallow audit errors */});
      }),
    );
  }
}
