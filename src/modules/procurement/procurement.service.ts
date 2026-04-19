import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';

@Injectable()
export class ProcurementService {
  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
  ) {}

  // ─── Vendors ─────────────────────────────────────────────────────────────────

  async createVendor(tenantId: string, data: any) {
    return this.prisma.vendor.create({ data: { tenantId, ...data } });
  }

  async getVendors(tenantId: string) {
    return this.prisma.vendor.findMany({
      where: { tenantId, isActive: true },
      include: {
        _count: { select: { purchaseOrders: true, vendorInvoices: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getVendor(tenantId: string, id: string) {
    const v = await this.prisma.vendor.findFirst({
      where: { id, tenantId },
      include: {
        purchaseOrders: { take: 5, orderBy: { createdAt: 'desc' } },
        vendorInvoices: { where: { status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } } },
      },
    });
    if (!v) throw new NotFoundException('Vendor not found');
    return v;
  }

  async updateVendor(tenantId: string, id: string, data: any) {
    await this.getVendor(tenantId, id);
    return this.prisma.vendor.update({ where: { id }, data });
  }

  // ─── Purchase Orders ──────────────────────────────────────────────────────────

  async createPurchaseOrder(tenantId: string, userId: string, data: any) {
    const count = await this.prisma.purchaseOrder.count({ where: { tenantId } });
    const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    const { lines, expectedDate, ...poData } = data;
    const subtotal = lines.reduce(
      (s: number, l: any) => s + l.quantity * l.unitPrice, 0,
    );
    const taxAmount = lines.reduce(
      (s: number, l: any) => s + (l.quantity * l.unitPrice * (l.taxRate || 0)) / 100, 0,
    );

    return this.prisma.purchaseOrder.create({
      data: {
        tenantId,
        ...poData,
        ...(expectedDate && { expectedDate: new Date(expectedDate) }),
        poNumber,
        createdById: userId,
        subtotal,
        taxAmount,
        total: subtotal + taxAmount,
        lines: {
          create: lines.map((l: any) => ({
            stockItemId: l.stockItemId,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate || 0,
            lineTotal: l.quantity * l.unitPrice * (1 + (l.taxRate || 0) / 100),
            notes: l.notes,
          })),
        },
      },
      include: { vendor: true, lines: { include: { stockItem: true } } },
    });
  }

  async getPurchaseOrders(tenantId: string, filters: any = {}) {
    const { branchId, status, vendorId } = filters;
    return this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        ...(branchId && { branchId }),
        ...(status && { status }),
        ...(vendorId && { vendorId }),
      },
      include: { vendor: { select: { id: true, name: true } }, _count: { select: { lines: true, grns: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPurchaseOrder(tenantId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: {
        vendor: true,
        lines: { include: { stockItem: true } },
        grns: { include: { lines: { include: { stockItem: true } } } },
        vendorInvoices: true,
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  async approvePurchaseOrder(tenantId: string, id: string, userId: string) {
    await this.getPurchaseOrder(tenantId, id);
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'SENT', approvedById: userId, approvedAt: new Date() },
    });
  }

  // ─── Goods Received Notes ─────────────────────────────────────────────────────

  async receiveGoods(tenantId: string, userId: string, data: any) {
    const po = await this.getPurchaseOrder(tenantId, data.purchaseOrderId);
    const count = await this.prisma.goodsReceivedNote.count();
    const grnNumber = `GRN-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const grn = await tx.goodsReceivedNote.create({
        data: {
          purchaseOrderId: data.purchaseOrderId,
          grnNumber,
          receivedById: userId,
          locationId: data.locationId,
          notes: data.notes,
          status: 'POSTED',
          lines: {
            create: data.lines.map((l: any) => ({
              stockItemId: l.stockItemId,
              orderedQty: l.orderedQty,
              receivedQty: l.receivedQty,
              unitCost: l.unitCost,
              expiryDate: l.expiryDate,
              batchNumber: l.batchNumber,
            })),
          },
        },
        include: { lines: true },
      });

      // Update PO received quantities
      for (const line of data.lines) {
        await tx.purchaseOrderLine.updateMany({
          where: { purchaseOrderId: data.purchaseOrderId, stockItemId: line.stockItemId },
          data: { receivedQty: { increment: line.receivedQty } },
        });
      }

      // Update PO status
      const updatedLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: data.purchaseOrderId },
      });
      const allReceived = updatedLines.every(l => Number(l.receivedQty) >= Number(l.quantity));
      const anyReceived = updatedLines.some(l => Number(l.receivedQty) > 0);
      await tx.purchaseOrder.update({
        where: { id: data.purchaseOrderId },
        data: {
          status: allReceived ? 'RECEIVED' : anyReceived ? 'PARTIAL' : 'SENT',
          deliveredDate: new Date(),
        },
      });

      return grn;
    }).then(async (grn) => {
      // Record stock movements for received goods
      for (const line of data.lines) {
        await this.inventoryService.recordMovement({
          stockItemId: line.stockItemId,
          locationId: data.locationId,
          type: 'PURCHASE',
          quantity: line.receivedQty,
          unitCost: line.unitCost,
          reference: grn.id,
          referenceType: 'GRN',
        }).catch(() => {});
      }
      return grn;
    });
  }

  // ─── Vendor Invoices & Payments ───────────────────────────────────────────────

  async createVendorInvoice(data: any) {
    return this.prisma.vendorInvoice.create({ data });
  }

  async getVendorInvoices(tenantId: string, filters: any = {}) {
    return this.prisma.vendorInvoice.findMany({
      where: {
        vendor: { tenantId },
        ...(filters.status && { status: filters.status }),
        ...(filters.vendorId && { vendorId: filters.vendorId }),
      },
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    });
  }

  async recordVendorPayment(tenantId: string, data: any) {
    const invoice = await this.prisma.vendorInvoice.findFirst({
      where: { id: data.invoiceId, vendor: { tenantId } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.vendorPayment.create({
        data: {
          vendorId: invoice.vendorId,
          invoiceId: data.invoiceId,
          amount: data.amount,
          method: data.method,
          reference: data.reference,
        },
      });
      const newPaid = Number(invoice.paidAmount) + Number(data.amount);
      const status = newPaid >= Number(invoice.amount) ? 'PAID'
        : newPaid > 0 ? 'PARTIAL' : 'UNPAID';
      await tx.vendorInvoice.update({
        where: { id: data.invoiceId },
        data: { paidAmount: newPaid, status },
      });
      return payment;
    });
  }
}
