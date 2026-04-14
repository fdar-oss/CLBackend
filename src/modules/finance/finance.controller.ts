import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(private svc: FinanceService) {}

  @Post('expenses')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.FINANCE_MANAGER)
  createExpense(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createExpense(u.tenantId, u.sub, body);
  }

  @Get('expenses') getExpenses(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.svc.getExpenses(u.tenantId, filters);
  }

  @Patch('expenses/:id/approve')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.FINANCE_MANAGER)
  approveExpense(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.approveExpense(id, u.sub);
  }

  @Get('expense-categories') getCategories(@CurrentUser() u: JwtPayload) {
    return this.svc.getExpenseCategories(u.tenantId);
  }

  @Post('expense-categories')
  createCategory(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createExpenseCategory(u.tenantId, body.name);
  }

  @Get('daily-summaries')
  @ApiOperation({ summary: 'Daily sales summaries by branch and date range' })
  getDailySummaries(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.svc.getDailySummaries(u.tenantId, filters);
  }

  @Post('daily-summaries/build')
  @ApiOperation({ summary: 'Manually trigger daily summary computation for a branch+date' })
  buildSummary(@Body() body: any) {
    return this.svc.buildDailySummary(body.branchId, new Date(body.date));
  }

  @Get('reports/sales')
  @ApiOperation({ summary: 'Sales report for a date range' })
  getSalesReport(
    @CurrentUser() u: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.getSalesReport(u.tenantId, from, to, branchId);
  }

  @Get('reports/profit-loss')
  @ApiOperation({ summary: 'P&L report for a date range' })
  getProfitLoss(
    @CurrentUser() u: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.getProfitLoss(u.tenantId, from, to, branchId);
  }
}
