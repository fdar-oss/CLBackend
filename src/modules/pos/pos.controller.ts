import {
  Controller, Get, Post, Patch, Body, Param, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PosService } from './pos.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('POS')
@ApiBearerAuth()
@Controller('pos')
export class PosController {
  constructor(private posService: PosService) {}

  // ─── Shifts ──────────────────────────────────────────────────────────────────

  @Post('shifts/open')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Open a POS shift (requires opening float)' })
  openShift(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.posService.openShift(body.branchId || u.branchId || '', u.sub, body.openingFloat);
  }

  @Post('shifts/:id/close')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Close shift and generate Z report' })
  closeShift(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.posService.closeShift(id, u.sub, body.closingCash, body.notes);
  }

  @Get('shifts/active')
  @ApiOperation({ summary: 'Get currently open shift for branch' })
  getActiveShift(@CurrentUser() u: JwtPayload, @Query('branchId') branchId: string) {
    return this.posService.getActiveShift(branchId || u.branchId || '');
  }

  @Post('shifts/:id/cash-movement')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Record cash in/out movement' })
  addCashMovement(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.posService.addCashMovement(id, body.type, body.amount, body.reason, u.sub);
  }

  // ─── Orders ──────────────────────────────────────────────────────────────────

  @Post('orders')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.CASHIER, UserRole.WAITER)
  @ApiOperation({ summary: 'Create new POS order' })
  createOrder(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.posService.createOrder(u.tenantId, body.branchId || u.branchId || '', u.sub, body);
  }

  @Get('orders')
  @ApiOperation({ summary: 'List orders with optional filters' })
  getOrders(
    @CurrentUser() u: JwtPayload,
    @Query('branchId') branchId: string,
    @Query('status') status?: string,
    @Query('orderType') orderType?: string,
    @Query('date') date?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.posService.getOrders(u.tenantId, branchId || u.branchId || '', {
      status, orderType, date, page, limit,
    });
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Get order detail' })
  getOrder(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.posService.getOrder(u.tenantId, id);
  }

  @Patch('orders/:id/status')
  @ApiOperation({ summary: 'Update order status' })
  updateOrderStatus(
    @CurrentUser() u: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.posService.updateOrderStatus(u.tenantId, id, body.status);
  }

  // ─── Payments ────────────────────────────────────────────────────────────────

  @Post('orders/:id/payment')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Process payment for an order (supports split payment)' })
  processPayment(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.posService.processPayment(u.tenantId, id, body.payments);
  }

  @Post('orders/:id/refund')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Process refund for an order' })
  processRefund(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.posService.processRefund(
      u.tenantId, id, body.amount, body.reason, body.method, u.sub,
    );
  }

  // ─── Tables ──────────────────────────────────────────────────────────────────

  @Get('tables')
  @ApiOperation({ summary: 'Get table layout with live status' })
  getTables(@CurrentUser() u: JwtPayload, @Query('branchId') branchId: string) {
    return this.posService.getTables(branchId || u.branchId || '');
  }

  @Post('tables')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Add a table' })
  createTable(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.posService.createTable(body.branchId || u.branchId || '', body);
  }

  @Patch('tables/:id/status')
  @ApiOperation({ summary: 'Update table status (Available, Occupied, Cleaning...)' })
  updateTableStatus(
    @CurrentUser() u: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: string; branchId: string },
  ) {
    return this.posService.updateTableStatus(
      body.branchId || u.branchId || '', id, body.status,
    );
  }
}
