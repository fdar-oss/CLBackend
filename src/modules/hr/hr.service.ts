import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HrService {
  constructor(private prisma: PrismaService) {}

  // ─── Employees ───────────────────────────────────────────────────────────────

  async createEmployee(tenantId: string, data: any) {
    const count = await this.prisma.employee.count({ where: { tenantId } });
    const employeeCode = data.employeeCode || `EMP-${String(count + 1).padStart(4, '0')}`;
    return this.prisma.employee.create({
      data: { tenantId, ...data, employeeCode },
      include: { department: true, designation: true, branch: { select: { name: true } } },
    });
  }

  async getEmployees(tenantId: string, branchId?: string) {
    return this.prisma.employee.findMany({
      where: { tenantId, isActive: true, ...(branchId && { branchId }) },
      include: { department: true, designation: true, branch: { select: { id: true, name: true } } },
      orderBy: { fullName: 'asc' },
    });
  }

  async getEmployee(tenantId: string, id: string) {
    const e = await this.prisma.employee.findFirst({
      where: { id, tenantId },
      include: {
        department: true, designation: true,
        branch: { select: { id: true, name: true } },
        attendance: { take: 30, orderBy: { date: 'desc' } },
        leaves: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!e) throw new NotFoundException('Employee not found');
    return e;
  }

  async updateEmployee(tenantId: string, id: string, data: any) {
    await this.getEmployee(tenantId, id);
    return this.prisma.employee.update({ where: { id }, data });
  }

  async terminateEmployee(tenantId: string, id: string, terminationDate: Date) {
    await this.getEmployee(tenantId, id);
    return this.prisma.employee.update({
      where: { id },
      data: { isActive: false, terminationDate },
    });
  }

  // ─── Departments & Designations ───────────────────────────────────────────────

  async createDepartment(tenantId: string, name: string) {
    return this.prisma.department.create({ data: { tenantId, name } });
  }

  async getDepartments(tenantId: string) {
    return this.prisma.department.findMany({
      where: { tenantId },
      include: { _count: { select: { employees: true } } },
    });
  }

  async createDesignation(tenantId: string, name: string) {
    return this.prisma.designation.create({ data: { tenantId, name } });
  }

  async getDesignations(tenantId: string) {
    return this.prisma.designation.findMany({ where: { tenantId } });
  }

  // ─── Attendance ───────────────────────────────────────────────────────────────

  async checkIn(employeeId: string, branchId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (existing?.checkIn) throw new ConflictException('Already checked in today');

    return this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: today } },
      update: { checkIn: new Date(), status: 'PRESENT' },
      create: { employeeId, branchId, date: today, checkIn: new Date(), status: 'PRESENT' },
    });
  }

  async checkOut(employeeId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const record = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (!record?.checkIn) throw new NotFoundException('No check-in record for today');

    const hoursWorked = (Date.now() - record.checkIn.getTime()) / 3600000;
    const overtime = Math.max(0, hoursWorked - 8);

    return this.prisma.attendance.update({
      where: { id: record.id },
      data: { checkOut: new Date(), hoursWorked, overtime },
    });
  }

  async getAttendance(tenantId: string, filters: any = {}) {
    const { employeeId, branchId, from, to } = filters;
    return this.prisma.attendance.findMany({
      where: {
        employee: { tenantId },
        ...(employeeId && { employeeId }),
        ...(branchId && { branchId }),
        ...(from && to && { date: { gte: new Date(from), lte: new Date(to) } }),
      },
      include: { employee: { select: { fullName: true, employeeCode: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async markAttendance(data: any) {
    return this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: data.employeeId, date: new Date(data.date) } },
      update: { status: data.status, notes: data.notes },
      create: { ...data, date: new Date(data.date) },
    });
  }

  // ─── Leaves ───────────────────────────────────────────────────────────────────

  async applyLeave(data: any) {
    return this.prisma.leave.create({ data });
  }

  async getLeaves(tenantId: string, filters: any = {}) {
    return this.prisma.leave.findMany({
      where: {
        employee: { tenantId },
        ...(filters.employeeId && { employeeId: filters.employeeId }),
        ...(filters.status && { status: filters.status }),
      },
      include: { employee: { select: { fullName: true, employeeCode: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveLeave(id: string, approverId: string) {
    return this.prisma.leave.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: approverId, approvedAt: new Date() },
    });
  }

  async rejectLeave(id: string, approverId: string) {
    return this.prisma.leave.update({
      where: { id },
      data: { status: 'REJECTED', approvedById: approverId, approvedAt: new Date() },
    });
  }

  // ─── Payroll ──────────────────────────────────────────────────────────────────

  async generatePayroll(tenantId: string, month: number, year: number, userId: string) {
    const existingPeriod = await this.prisma.payrollPeriod.findUnique({
      where: { tenantId_month_year: { tenantId, month, year } },
    });
    if (existingPeriod) throw new ConflictException('Payroll for this period already exists');

    const employees = await this.prisma.employee.findMany({
      where: { tenantId, isActive: true },
    });

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    return this.prisma.$transaction(async (tx) => {
      const period = await tx.payrollPeriod.create({
        data: {
          tenantId, month, year, startDate, endDate,
          processedById: userId,
          status: 'DRAFT',
        },
      });

      for (const emp of employees) {
        // Get overtime from attendance
        const attendanceData = await tx.attendance.aggregate({
          where: { employeeId: emp.id, date: { gte: startDate, lte: endDate } },
          _sum: { hoursWorked: true, overtime: true },
        });
        const overtimeHours = Number(attendanceData._sum.overtime || 0);
        const hourlyRate = emp.salaryType === 'MONTHLY'
          ? Number(emp.baseSalary) / 208
          : Number(emp.baseSalary);
        const overtime = overtimeHours * hourlyRate * 1.5;

        const netSalary = Number(emp.baseSalary) + overtime;

        await tx.payrollEntry.create({
          data: {
            periodId: period.id,
            employeeId: emp.id,
            baseSalary: emp.baseSalary,
            overtime,
            netSalary,
          },
        });
      }

      return period;
    });
  }

  async getPayrollPeriods(tenantId: string) {
    return this.prisma.payrollPeriod.findMany({
      where: { tenantId },
      include: { _count: { select: { entries: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async getPayrollEntries(periodId: string) {
    return this.prisma.payrollEntry.findMany({
      where: { periodId },
      include: {
        employee: {
          select: { fullName: true, employeeCode: true, bankAccount: true, bankName: true },
        },
      },
    });
  }

  // ─── Employee Shifts / Scheduling ──────────────────────────────────────────

  async createShift(data: any) {
    return this.prisma.employeeShift.create({
      data: { ...data, date: new Date(data.date) },
      include: { employee: { select: { fullName: true, employeeCode: true } }, branch: { select: { name: true } } },
    });
  }

  async getShifts(tenantId: string, filters: any = {}) {
    const { branchId, from, to, employeeId } = filters;
    return this.prisma.employeeShift.findMany({
      where: {
        employee: { tenantId },
        ...(branchId && { branchId }),
        ...(employeeId && { employeeId }),
        ...(from && to && { date: { gte: new Date(from), lte: new Date(to) } }),
      },
      include: {
        employee: { select: { fullName: true, employeeCode: true, baseSalary: true, salaryType: true } },
        branch: { select: { name: true } },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
  }

  async deleteShift(id: string) {
    await this.prisma.employeeShift.delete({ where: { id } });
    return { deleted: true };
  }

  async getLaborSummary(tenantId: string, from: string, to: string, branchId?: string) {
    const shifts = await this.getShifts(tenantId, { branchId, from, to });

    // Calculate hours per employee
    const empMap: Record<string, { name: string; code: string; salary: number; salaryType: string; totalHours: number; shifts: number }> = {};
    for (const s of shifts) {
      const key = s.employeeId;
      if (!empMap[key]) {
        empMap[key] = {
          name: s.employee.fullName,
          code: s.employee.employeeCode,
          salary: Number(s.employee.baseSalary),
          salaryType: s.employee.salaryType,
          totalHours: 0,
          shifts: 0,
        };
      }
      // Parse hours from startTime/endTime (e.g. "09:00" to "17:00" = 8h)
      const [sh, sm] = s.startTime.split(':').map(Number);
      const [eh, em] = s.endTime.split(':').map(Number);
      const hours = (eh + em / 60) - (sh + sm / 60);
      empMap[key].totalHours += hours > 0 ? hours : hours + 24; // handle overnight
      empMap[key].shifts += 1;
    }

    const employees = Object.values(empMap).map(e => {
      // For monthly salary: hourly = salary / 208 (26 days × 8 hours)
      const hourlyRate = e.salaryType === 'MONTHLY' ? e.salary / 208 : e.salary;
      const laborCost = e.totalHours * hourlyRate;
      return { ...e, hourlyRate, laborCost };
    });

    const totalLaborCost = employees.reduce((s, e) => s + e.laborCost, 0);
    const totalHours = employees.reduce((s, e) => s + e.totalHours, 0);
    const totalShifts = shifts.length;

    return { employees, totalLaborCost, totalHours, totalShifts };
  }

  async approvePayroll(periodId: string) {
    return this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: { status: 'APPROVED' },
    });
  }
}
