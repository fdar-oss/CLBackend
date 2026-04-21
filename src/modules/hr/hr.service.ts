import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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

  async checkIn(employeeId: string, branchId: string, clientIp?: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Employee not found');

    // WiFi IP check (if configured)
    if (clientIp) {
      const config = await this.prisma.attendanceConfig.findUnique({ where: { tenantId: employee.tenantId } });
      if (config && config.allowedIPs && config.allowedIPs.length > 0 && !config.allowedIPs.includes(clientIp)) {
        throw new BadRequestException('You must be connected to the shop WiFi to clock in');
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (existing?.checkIn) throw new ConflictException('Already checked in today');

    const now = new Date();
    const scheduledStart = employee.scheduleStart || '09:00';

    // Calculate late minutes
    const [schH, schM] = scheduledStart.split(':').map(Number);
    const scheduledTime = new Date(now); scheduledTime.setHours(schH, schM, 0, 0);
    const lateMinutes = now > scheduledTime ? Math.floor((now.getTime() - scheduledTime.getTime()) / 60000) : 0;

    // Calculate late deduction: (lateMinutes / totalShiftMinutes) × dailySalary
    const dailyHours = Number(employee.dailyHours || 8);
    const shiftMinutes = dailyHours * 60;
    const dailySalary = Number(employee.baseSalary) / (employee.workingDaysPerMonth || 26);
    const lateDeduction = lateMinutes > 0 ? Math.round((lateMinutes / shiftMinutes) * dailySalary) : 0;

    const status = lateMinutes > 0 ? 'LATE' : 'PRESENT';

    return this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: today } },
      update: { checkIn: now, status: status as any, scheduledStart, scheduledEnd: employee.scheduleEnd, lateMinutes, lateDeduction },
      create: {
        employeeId, branchId, date: today, checkIn: now,
        scheduledStart, scheduledEnd: employee.scheduleEnd,
        status: status as any, lateMinutes, lateDeduction,
      },
      include: { employee: { select: { fullName: true } } },
    });
  }

  async checkOut(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const record = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (!record?.checkIn) throw new NotFoundException('No check-in record for today');

    const now = new Date();
    const hoursWorked = (now.getTime() - record.checkIn.getTime()) / 3600000;
    const dailyHours = Number(employee.dailyHours || 8);

    // Check if today is a holiday
    const holiday = await this.prisma.holidayCalendar.findFirst({
      where: { tenantId: employee.tenantId, date: today },
    });

    // Overtime: hours beyond scheduled daily hours
    // For closing staff: only count overtime beyond their scheduled end
    let overtime = 0;
    if (hoursWorked > dailyHours) {
      if (employee.isClosingStaff && !holiday) {
        // Closing staff: check if they went beyond scheduled end
        const [endH, endM] = (employee.scheduleEnd || '23:00').split(':').map(Number);
        const scheduledEnd = new Date(today); scheduledEnd.setHours(endH, endM, 0, 0);
        if (endH < 12) scheduledEnd.setDate(scheduledEnd.getDate() + 1); // next day for after-midnight
        if (now > scheduledEnd) {
          overtime = (now.getTime() - scheduledEnd.getTime()) / 3600000;
        }
      } else {
        overtime = hoursWorked - dailyHours;
      }
    }

    // Early leave
    const earlyLeaveMin = hoursWorked < dailyHours ? Math.floor((dailyHours - hoursWorked) * 60) : 0;

    return this.prisma.attendance.update({
      where: { id: record.id },
      data: { checkOut: now, hoursWorked: Math.round(hoursWorked * 100) / 100, overtime: Math.round(overtime * 100) / 100, earlyLeaveMin },
      include: { employee: { select: { fullName: true } } },
    });
  }

  async forgiveLateness(attendanceId: string) {
    return this.prisma.attendance.update({
      where: { id: attendanceId },
      data: { lateForgiven: true, lateDeduction: 0 },
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
      include: { employee: { select: { fullName: true, employeeCode: true, scheduleStart: true, dailyHours: true } } },
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

  async getAttendanceSummary(tenantId: string, month: number, year: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const employees = await this.prisma.employee.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, fullName: true, employeeCode: true, baseSalary: true, workingDaysPerMonth: true, paidOffDays: true, dailyHours: true },
    });

    const attendance = await this.prisma.attendance.findMany({
      where: { employee: { tenantId }, date: { gte: startDate, lte: endDate } },
    });

    return employees.map(emp => {
      const empAttendance = attendance.filter(a => a.employeeId === emp.id);
      const present = empAttendance.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length;
      const absent = empAttendance.filter(a => a.status === 'ABSENT').length;
      const late = empAttendance.filter(a => a.status === 'LATE').length;
      const onLeave = empAttendance.filter(a => a.status === 'ON_LEAVE').length;
      const totalHours = empAttendance.reduce((s, a) => s + Number(a.hoursWorked || 0), 0);
      const totalOvertime = empAttendance.reduce((s, a) => s + Number(a.overtime || 0), 0);
      const totalLateDeductions = empAttendance.filter(a => !a.lateForgiven).reduce((s, a) => s + Number(a.lateDeduction || 0), 0);
      const totalLateMinutes = empAttendance.reduce((s, a) => s + a.lateMinutes, 0);

      return {
        employeeId: emp.id, fullName: emp.fullName, employeeCode: emp.employeeCode,
        daysPresent: present, daysAbsent: absent, daysLate: late, daysOnLeave: onLeave,
        totalHours: Math.round(totalHours * 10) / 10,
        totalOvertime: Math.round(totalOvertime * 10) / 10,
        totalLateMinutes, totalLateDeductions,
      };
    });
  }

  // ─── Salary Advances ──────────────────────────────────────────────────────────

  async createAdvance(tenantId: string, data: any) {
    return this.prisma.salaryAdvance.create({
      data: {
        tenantId,
        employeeId: data.employeeId,
        amount: data.amount,
        remainingAmount: data.amount,
        monthlyInstallment: data.monthlyInstallment || null,
        reason: data.reason,
        givenDate: new Date(data.givenDate),
        givenById: data.givenById,
      },
      include: { employee: { select: { fullName: true, employeeCode: true } } },
    });
  }

  async getAdvances(tenantId: string, filters: any = {}) {
    return this.prisma.salaryAdvance.findMany({
      where: {
        tenantId,
        ...(filters.employeeId && { employeeId: filters.employeeId }),
        ...(filters.status && { status: filters.status }),
      },
      include: { employee: { select: { fullName: true, employeeCode: true } } },
      orderBy: { givenDate: 'desc' },
    });
  }

  // ─── Holiday Calendar ─────────────────────────────────────────────────────────

  async createHoliday(tenantId: string, data: any) {
    return this.prisma.holidayCalendar.create({
      data: { tenantId, date: new Date(data.date), name: data.name, overtimeRate: data.overtimeRate || 1.5 },
    });
  }

  async getHolidays(tenantId: string, year?: number) {
    const where: any = { tenantId };
    if (year) {
      where.date = { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31) };
    }
    return this.prisma.holidayCalendar.findMany({ where, orderBy: { date: 'asc' } });
  }

  async deleteHoliday(id: string) {
    await this.prisma.holidayCalendar.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Attendance Config ────────────────────────────────────────────────────────

  async getAttendanceConfig(tenantId: string) {
    return this.prisma.attendanceConfig.findUnique({ where: { tenantId } });
  }

  async updateAttendanceConfig(tenantId: string, data: any) {
    return this.prisma.attendanceConfig.upsert({
      where: { tenantId },
      update: { allowedIPs: data.allowedIPs || [], gracePeriodMin: data.gracePeriodMin || 0 },
      create: { tenantId, allowedIPs: data.allowedIPs || [], gracePeriodMin: data.gracePeriodMin || 0 },
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
    const daysInMonth = endDate.getDate();

    // Get holidays for this month
    const holidays = await this.prisma.holidayCalendar.findMany({
      where: { tenantId, date: { gte: startDate, lte: endDate } },
    });
    const holidayDates = new Set(holidays.map(h => h.date.toISOString().slice(0, 10)));

    return this.prisma.$transaction(async (tx) => {
      const period = await tx.payrollPeriod.create({
        data: { tenantId, month, year, startDate, endDate, processedById: userId, status: 'DRAFT' },
      });

      for (const emp of employees) {
        const baseSalary = Number(emp.baseSalary);
        const workingDays = emp.workingDaysPerMonth || 26;
        const paidOffDays = emp.paidOffDays || 4;
        const dailyHours = Number(emp.dailyHours || 8);
        const dailySalary = baseSalary / workingDays;
        const hourlyRate = dailySalary / dailyHours;

        // Get attendance records for this month
        const records = await tx.attendance.findMany({
          where: { employeeId: emp.id, date: { gte: startDate, lte: endDate } },
        });

        const daysPresent = records.filter(r => r.status === 'PRESENT' || r.status === 'LATE').length;
        const daysAbsent = records.filter(r => r.status === 'ABSENT').length;
        const daysLate = records.filter(r => r.status === 'LATE').length;
        const daysOnLeave = records.filter(r => r.status === 'ON_LEAVE').length;

        // Overtime calculation
        let totalOvertimeHours = 0;
        let totalOvertimePay = 0;
        for (const rec of records) {
          const ot = Number(rec.overtime || 0);
          if (ot > 0) {
            const dateStr = rec.date.toISOString().slice(0, 10);
            const isHoliday = holidayDates.has(dateStr);
            const rate = isHoliday ? 1.5 : 1.0;
            totalOvertimeHours += ot;
            totalOvertimePay += Math.round(ot * hourlyRate * rate);
          }
        }

        // Late deductions (only non-forgiven)
        const lateDeductions = records
          .filter(r => !r.lateForgiven)
          .reduce((s, r) => s + Number(r.lateDeduction || 0), 0);

        // Absent deductions (unapproved absences — no pay)
        const absentDeductions = Math.round(daysAbsent * dailySalary);

        // Paid off days: 4 per month
        // If worked more than workingDays, unused off days = extra pay
        const offDaysUsedForLeave = Math.min(daysOnLeave, paidOffDays);
        const totalDaysWorked = daysPresent;
        const unusedPaidDays = totalDaysWorked >= workingDays
          ? paidOffDays - offDaysUsedForLeave
          : 0;
        const extraDaysPay = Math.round(unusedPaidDays * dailySalary);

        // Advance deduction
        const activeAdvances = await tx.salaryAdvance.findMany({
          where: { employeeId: emp.id, status: 'ACTIVE' },
        });
        let advanceDeduction = 0;
        for (const adv of activeAdvances) {
          const remaining = Number(adv.remainingAmount);
          const installment = adv.monthlyInstallment ? Number(adv.monthlyInstallment) : remaining;
          const deduct = Math.min(installment, remaining);
          advanceDeduction += deduct;
          const newRemaining = remaining - deduct;
          await tx.salaryAdvance.update({
            where: { id: adv.id },
            data: {
              remainingAmount: newRemaining,
              status: newRemaining <= 0 ? 'FULLY_DEDUCTED' : 'ACTIVE',
            },
          });
        }

        // Calculate totals
        const grossSalary = baseSalary + totalOvertimePay + extraDaysPay;
        const totalDeductions = lateDeductions + absentDeductions + advanceDeduction;
        const netSalary = Math.max(0, grossSalary - totalDeductions);

        const payStubData = {
          employeeName: emp.fullName,
          employeeCode: emp.employeeCode,
          department: emp.departmentId,
          month, year,
          baseSalary, dailySalary: Math.round(dailySalary), hourlyRate: Math.round(hourlyRate),
          workingDays, paidOffDays,
          daysPresent, daysAbsent, daysLate, daysOnLeave,
          totalOvertimeHours: Math.round(totalOvertimeHours * 10) / 10,
          overtimePay: totalOvertimePay,
          extraDaysPay, unusedPaidDays,
          lateDeductions, absentDeductions, advanceDeduction,
          grossSalary, totalDeductions, netSalary,
          bankAccount: emp.bankAccount, bankName: emp.bankName,
        };

        await tx.payrollEntry.create({
          data: {
            periodId: period.id,
            employeeId: emp.id,
            baseSalary,
            daysWorked: daysPresent,
            daysAbsent, daysLate,
            paidOffDaysUsed: offDaysUsedForLeave,
            paidOffDaysUnused: unusedPaidDays,
            extraDaysPay,
            overtimeHours: totalOvertimeHours,
            overtimePay: totalOvertimePay,
            lateDeductions, absentDeductions, advanceDeduction,
            grossSalary, totalDeductions, netSalary,
            payStubData,
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
