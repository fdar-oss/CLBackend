import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { HrService } from './hr.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('HR')
@ApiBearerAuth()
@Controller('hr')
export class HrController {
  constructor(private svc: HrService) {}

  @Post('employees') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.HR_MANAGER)
  createEmployee(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createEmployee(u.tenantId, body);
  }

  @Get('employees') getEmployees(@CurrentUser() u: JwtPayload, @Query('branchId') branchId?: string) {
    return this.svc.getEmployees(u.tenantId, branchId);
  }

  @Get('employees/:id') getEmployee(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.getEmployee(u.tenantId, id);
  }

  @Patch('employees/:id') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.HR_MANAGER)
  updateEmployee(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateEmployee(u.tenantId, id, body);
  }

  @Patch('employees/:id/terminate') @Roles(UserRole.TENANT_OWNER, UserRole.HR_MANAGER)
  terminateEmployee(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.svc.terminateEmployee(u.tenantId, id, body.terminationDate);
  }

  @Post('departments') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.HR_MANAGER)
  createDepartment(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createDepartment(u.tenantId, body.name);
  }

  @Get('departments') getDepartments(@CurrentUser() u: JwtPayload) {
    return this.svc.getDepartments(u.tenantId);
  }

  @Post('designations') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.HR_MANAGER)
  createDesignation(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createDesignation(u.tenantId, body.name);
  }

  @Get('designations') getDesignations(@CurrentUser() u: JwtPayload) {
    return this.svc.getDesignations(u.tenantId);
  }

  @Post('attendance/check-in')
  @ApiOperation({ summary: 'Employee check-in (starts tracking work hours)' })
  checkIn(@Body() body: any) {
    return this.svc.checkIn(body.employeeId, body.branchId);
  }

  @Post('attendance/check-out')
  checkOut(@Body() body: any) {
    return this.svc.checkOut(body.employeeId);
  }

  @Get('attendance') getAttendance(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.svc.getAttendance(u.tenantId, filters);
  }

  @Post('attendance/mark') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.HR_MANAGER)
  markAttendance(@Body() body: any) {
    return this.svc.markAttendance(body);
  }

  @Post('leaves') applyLeave(@Body() body: any) {
    return this.svc.applyLeave(body);
  }

  @Get('leaves') getLeaves(@CurrentUser() u: JwtPayload, @Query() filters: any) {
    return this.svc.getLeaves(u.tenantId, filters);
  }

  @Patch('leaves/:id/approve') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.HR_MANAGER)
  approveLeave(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.approveLeave(id, u.sub);
  }

  @Patch('leaves/:id/reject') @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER, UserRole.HR_MANAGER)
  rejectLeave(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.rejectLeave(id, u.sub);
  }

  @Post('payroll/generate') @Roles(UserRole.TENANT_OWNER, UserRole.HR_MANAGER, UserRole.FINANCE_MANAGER)
  @ApiOperation({ summary: 'Auto-generate payroll for a month (pulls attendance data)' })
  generatePayroll(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.generatePayroll(u.tenantId, body.month, body.year, u.sub);
  }

  @Get('payroll/periods') getPayrollPeriods(@CurrentUser() u: JwtPayload) {
    return this.svc.getPayrollPeriods(u.tenantId);
  }

  @Get('payroll/periods/:id/entries') getPayrollEntries(@Param('id') id: string) {
    return this.svc.getPayrollEntries(id);
  }

  @Patch('payroll/periods/:id/approve') @Roles(UserRole.TENANT_OWNER, UserRole.FINANCE_MANAGER)
  approvePayroll(@Param('id') id: string) {
    return this.svc.approvePayroll(id);
  }
}
