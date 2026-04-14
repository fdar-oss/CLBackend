import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class FbrService {
  private readonly logger = new Logger(FbrService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // ─── Terminal Management ─────────────────────────────────────────────────────

  async registerTerminal(branchId: string, data: {
    terminalId: string;
    terminalName?: string;
    posId?: string;
  }) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, tenantId: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const existing = await this.prisma.fbrTerminal.findFirst({
      where: { branchId, terminalId: data.terminalId },
    });

    if (existing) {
      return this.prisma.fbrTerminal.update({
        where: { id: existing.id },
        data: {
          terminalName: data.terminalName,
          posId: data.posId,
          isActive: true,
          registeredAt: new Date(),
        },
      });
    }

    return this.prisma.fbrTerminal.create({
      data: {
        tenantId: branch.tenantId,
        branchId,
        terminalId: data.terminalId,
        terminalName: data.terminalName,
        posId: data.posId,
        registeredAt: new Date(),
      },
    });
  }

  async getTerminals(branchId: string) {
    return this.prisma.fbrTerminal.findMany({ where: { branchId } });
  }

  // ─── Invoice Submission ──────────────────────────────────────────────────────

  @OnEvent('fbr.submitInvoice')
  async handleSubmitInvoice(payload: { orderId: string; tenantId: string }) {
    await this.submitInvoice(payload.orderId, payload.tenantId);
  }

  async submitInvoice(orderId: string, tenantId: string): Promise<void> {
    const order = await this.prisma.posOrder.findFirst({
      where: { id: orderId, tenantId },
      include: {
        orderItems: true,
        payments: { where: { status: 'COMPLETED' } },
        branch: {
          include: {
            fbrTerminals: { where: { isActive: true }, take: 1 },
            tenant: { select: { ntn: true } },
          },
        },
      },
    });

    if (!order) {
      this.logger.warn(`FBR: Order ${orderId} not found`);
      return;
    }

    if (order.fbrInvoiceNo) return; // already submitted

    const terminal = order.branch.fbrTerminals[0];
    if (!terminal) {
      this.logger.warn(`FBR: No active terminal for branch ${order.branchId} — queuing`);
      await this.enqueueForSync(order, tenantId, 'No active FBR terminal registered');
      return;
    }

    const invoicePayload = this.buildInvoicePayload(order, terminal);

    try {
      const apiUrl = this.config.get<string>('fbr.apiUrl');
      const apiKey = this.config.get<string>('fbr.apiKey');

      const response = await axios.post(`${apiUrl}/invoice`, invoicePayload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        timeout: 10000,
      });

      const { invoiceNumber, qrCode } = response.data;

      await this.prisma.$transaction(async (tx) => {
        await tx.fbrInvoice.create({
          data: {
            orderId,
            terminalId: terminal.id,
            invoiceNumber,
            qrCode,
            fbrResponse: response.data,
          },
        });
        await tx.posOrder.update({
          where: { id: orderId },
          data: {
            fbrInvoiceNo: invoiceNumber,
            fbrQrCode: qrCode,
            fbrSubmittedAt: new Date(),
          },
        });
        // Mark sync queue entry as completed if one exists
        await tx.fbrSyncQueue.updateMany({
          where: { orderId },
          data: { status: 'COMPLETED' },
        });
      });

      this.logger.log(`FBR: Invoice submitted for order ${order.orderNumber} → ${invoiceNumber}`);
    } catch (err) {
      this.logger.error(
        `FBR: Submission failed for order ${order.orderNumber}: ${err.message}`,
      );
      await this.enqueueForSync(order, tenantId, err.message);
    }
  }

  // ─── Sync Queue ───────────────────────────────────────────────────────────────

  private async enqueueForSync(order: any, tenantId: string, reason: string) {
    const terminal = order.branch?.fbrTerminals?.[0];
    if (!terminal) return;

    const invoicePayload = this.buildInvoicePayload(order, terminal);
    const existing = await this.prisma.fbrSyncQueue.findUnique({ where: { orderId: order.id } });

    if (existing) {
      await this.prisma.fbrSyncQueue.update({
        where: { orderId: order.id },
        data: {
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          error: reason,
          status: 'PENDING',
        },
      });
    } else {
      await this.prisma.fbrSyncQueue.create({
        data: {
          orderId: order.id,
          tenantId,
          payload: invoicePayload,
          error: reason,
          status: 'PENDING',
        },
      });
    }
  }

  async getSyncQueue(tenantId: string) {
    const queue = await this.prisma.fbrSyncQueue.findMany({
      where: { tenantId, status: { not: 'COMPLETED' } },
      orderBy: { createdAt: 'asc' },
    });

    // Enrich with order info
    const orderIds = queue.map(q => q.orderId);
    const orders = await this.prisma.posOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true, branchId: true, total: true },
    });
    const orderMap = new Map(orders.map(o => [o.id, o]));

    return queue.map(q => ({ ...q, order: orderMap.get(q.orderId) ?? null }));
  }

  // ─── Cron: retry pending queue entries every 5 minutes ───────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryPendingSubmissions() {
    const pending = await this.prisma.fbrSyncQueue.findMany({
      where: {
        status: 'PENDING',
        attempts: { lt: 10 },
      },
      take: 50,
    });

    if (!pending.length) return;
    this.logger.log(`FBR sync: retrying ${pending.length} pending invoice(s)`);

    for (const entry of pending) {
      const order = await this.prisma.posOrder.findUnique({
        where: { id: entry.orderId },
        select: { fbrInvoiceNo: true },
      });

      // Already submitted via another path — mark completed
      if (order?.fbrInvoiceNo) {
        await this.prisma.fbrSyncQueue.update({
          where: { id: entry.id },
          data: { status: 'COMPLETED' },
        });
        continue;
      }

      await this.prisma.fbrSyncQueue.update({
        where: { id: entry.id },
        data: { status: 'PROCESSING', lastAttemptAt: new Date() },
      });

      try {
        const apiUrl = this.config.get<string>('fbr.apiUrl');
        const apiKey = this.config.get<string>('fbr.apiKey');

        const response = await axios.post(`${apiUrl}/invoice`, entry.payload, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          timeout: 10000,
        });

        const { invoiceNumber, qrCode } = response.data;

        await this.prisma.$transaction(async (tx) => {
          await tx.fbrSyncQueue.update({
            where: { id: entry.id },
            data: { status: 'COMPLETED', attempts: { increment: 1 } },
          });
          await tx.posOrder.update({
            where: { id: entry.orderId },
            data: {
              fbrInvoiceNo: invoiceNumber,
              fbrQrCode: qrCode,
              fbrSubmittedAt: new Date(),
            },
          });
        });

        this.logger.log(`FBR sync: order ${entry.orderId} submitted → ${invoiceNumber}`);
      } catch (err) {
        const newAttempts = entry.attempts + 1;
        await this.prisma.fbrSyncQueue.update({
          where: { id: entry.id },
          data: {
            status: newAttempts >= 10 ? 'FAILED' : 'PENDING',
            attempts: newAttempts,
            error: err.message,
          },
        });
        this.logger.warn(`FBR sync attempt ${newAttempts} failed for ${entry.orderId}: ${err.message}`);
      }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private buildInvoicePayload(order: any, terminal: any) {
    return {
      terminalId: terminal.terminalId,
      ntn: order.branch?.tenant?.ntn,
      invoiceDate: (order.completedAt || order.createdAt).toISOString(),
      orderNumber: order.orderNumber,
      paymentMode: this.getPaymentMode(order.payments),
      items: order.orderItems.map((item: any) => ({
        description: item.itemName,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        discount: 0,
        taxRate: Number(item.taxRate),
        taxAmount: Number(item.taxAmount),
        totalAmount: Number(item.lineTotal),
      })),
      totalAmount: Number(order.total),
      totalTax: Number(order.taxAmount),
      totalDiscount: Number(order.discountAmount || 0),
    };
  }

  private getPaymentMode(payments: any[]): string {
    if (!payments?.length) return 'CASH';
    const methods = [...new Set(payments.map((p: any) => p.method))];
    if (methods.length > 1) return 'MIXED';
    return methods[0];
  }
}
