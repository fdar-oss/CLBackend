import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProcurementService } from './procurement.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Procurement')
@ApiBearerAuth()
@Controller('procurement')
export class ProcurementController {
  constructor(private svc: ProcurementService) {}

  @Post('vendors') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  createVendor(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createVendor(u.tenantId, body);
  }

  @Get('vendors') getVendors(@CurrentUser() u: JwtPayload) {
    return this.svc.getVendors(u.tenantId);
  }

  @Get('vendors/:id') getVendor(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.getVendor(u.tenantId, id);
  }

  @Patch('vendors/:id') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  updateVendor(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateVendor(u.tenantId, id, body);
  }

  @Post('purchase-orders') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create purchase order' })
  createPO(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createPurchaseOrder(u.tenantId, u.sub, body);
  }

  @Get('purchase-orders') getPOs(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.svc.getPurchaseOrders(u.tenantId, filters);
  }

  @Get('purchase-orders/:id') getPO(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.getPurchaseOrder(u.tenantId, id);
  }

  @Patch('purchase-orders/:id/approve') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  approvePO(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.approvePurchaseOrder(u.tenantId, id, u.sub);
  }

  @Post('grn') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.INVENTORY_STAFF)
  @ApiOperation({ summary: 'Receive goods and post GRN (auto-updates stock)' })
  receiveGoods(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.receiveGoods(u.tenantId, u.sub, body);
  }

  @Post('vendor-invoices') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.FINANCE_MANAGER)
  createInvoice(@Body() body: any) {
    return this.svc.createVendorInvoice(body);
  }

  @Get('vendor-invoices') getInvoices(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.svc.getVendorInvoices(u.tenantId, filters);
  }

  @Post('vendor-payments') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.FINANCE_MANAGER)
  @ApiOperation({ summary: 'Record vendor payment against invoice' })
  recordPayment(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.recordVendorPayment(u.tenantId, body);
  }
}
