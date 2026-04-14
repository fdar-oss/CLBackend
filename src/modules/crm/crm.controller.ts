import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CrmService } from './crm.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('CRM')
@ApiBearerAuth()
@Controller('crm')
export class CrmController {
  constructor(private svc: CrmService) {}

  @Post('customers')
  createCustomer(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createCustomer(u.tenantId, body);
  }

  @Get('customers') getCustomers(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.svc.getCustomers(u.tenantId, filters);
  }

  @Get('customers/:id') getCustomer(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.getCustomer(u.tenantId, id);
  }

  @Patch('customers/:id')
  updateCustomer(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateCustomer(u.tenantId, id, body);
  }

  @Post('reservations')
  @ApiOperation({ summary: 'Create reservation (from POS or website)' })
  createReservation(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createReservation(u.tenantId, body);
  }

  @Get('reservations') getReservations(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.svc.getReservations(u.tenantId, filters);
  }

  @Patch('reservations/:id/status')
  updateReservation(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateReservationStatus(u.tenantId, id, body.status, body.tableId);
  }

  @Post('feedback')
  @ApiOperation({ summary: 'Submit customer feedback / rating' })
  submitFeedback(@Body() body: any) {
    return this.svc.submitFeedback(body);
  }

  @Get('feedback') getFeedback(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.svc.getFeedback(u.tenantId, filters);
  }

  @Post('complaints') createComplaint(@Body() body: any) {
    return this.svc.createComplaint(body);
  }

  @Get('complaints') getComplaints(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.svc.getComplaints(u.tenantId, filters);
  }

  @Patch('complaints/:id/resolve')
  resolveComplaint(@Param('id') id: string, @Body() body: any) {
    return this.svc.resolveComplaint(id, body.resolution);
  }

  @Get('loyalty/program')
  getLoyaltyProgram(@CurrentUser() u: JwtPayload) {
    return this.svc.getLoyaltyProgram(u.tenantId);
  }

  @Patch('loyalty/program')
  updateLoyaltyProgram(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.updateLoyaltyProgram(u.tenantId, body);
  }

  @Get('loyalty/account/:customerId')
  getLoyaltyAccount(@Param('customerId') id: string) {
    return this.svc.getLoyaltyAccount(id);
  }

  @Post('loyalty/redeem')
  @ApiOperation({ summary: 'Redeem loyalty points at checkout' })
  redeemPoints(@Body() body: any) {
    return this.svc.redeemPoints(body.customerId, body.points, body.orderId);
  }
}
