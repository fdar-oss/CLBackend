import {
  WebSocketGateway, WebSocketServer,
  SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect,
  MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true },
  namespace: '/kds',
})
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(KdsGateway.name);

  constructor(private prisma: PrismaService) {}

  handleConnection(client: Socket) {
    this.logger.log(`KDS client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`KDS client disconnected: ${client.id}`);
  }

  // KDS screen joins branch room to receive only that branch's tickets
  @SubscribeMessage('joinBranch')
  handleJoinBranch(@ConnectedSocket() client: Socket, @MessageBody() data: { branchId: string }) {
    client.join(`branch:${data.branchId}`);
    this.logger.log(`Client ${client.id} joined branch room: ${data.branchId}`);
    return { event: 'joined', room: `branch:${data.branchId}` };
  }

  // Chef bumps a ticket (marks as in-progress or ready)
  @SubscribeMessage('bumpTicket')
  async handleBumpTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: string; status: string },
  ) {
    const ticket = await this.prisma.kitchenTicket.update({
      where: { id: data.ticketId },
      data: {
        status: data.status as any,
        ...(data.status === 'IN_PROGRESS' && { startedAt: new Date() }),
        ...(data.status === 'READY' && { completedAt: new Date() }),
        ...(data.status === 'BUMPED' && { bumpedAt: new Date() }),
      },
      include: {
        station: true,
        order: { select: { branchId: true, orderNumber: true, orderType: true, table: { select: { number: true, section: true } } } },
      },
    });

    // Broadcast to the branch room
    this.server
      .to(`branch:${ticket.order.branchId}`)
      .emit('ticketUpdated', ticket);

    return ticket;
  }

  // When a new POS order is created, create kitchen tickets and broadcast
  @OnEvent('order.created')
  async handleOrderCreated(order: any) {
    await this.createKitchenTickets(order);
  }

  private async createKitchenTickets(order: any) {
    // Ensure default stations exist (Kitchen + Bar)
    let stations = await this.prisma.kitchenStation.findMany({
      where: { branchId: order.branchId, isActive: true },
    });
    if (!stations.find((s) => s.type === 'KITCHEN')) {
      const k = await this.prisma.kitchenStation.create({
        data: { branchId: order.branchId, name: 'Kitchen', type: 'KITCHEN' },
      });
      stations.push(k);
    }
    if (!stations.find((s) => s.type === 'BAR')) {
      const b = await this.prisma.kitchenStation.create({
        data: { branchId: order.branchId, name: 'Bar', type: 'BAR' },
      });
      stations.push(b);
    }

    const kitchenStation = stations.find((s) => s.type === 'KITCHEN')!;
    const barStation = stations.find((s) => s.type === 'BAR')!;

    // Look up itemType for each ordered menu item
    const itemIds = order.orderItems.map((i: any) => i.menuItemId);
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemType: true },
    });
    const typeMap = new Map(menuItems.map((m) => [m.id, m.itemType]));

    // Route by type: BEVERAGE → bar, everything else → kitchen
    const barItems: any[] = [];
    const kitchenItems: any[] = [];
    for (const item of order.orderItems) {
      const t = typeMap.get(item.menuItemId);
      const slim = {
        name: item.itemName,
        quantity: item.quantity,
        notes: item.notes,
        modifiers: item.modifiers?.map((m: any) => m.modifierName) || [],
      };
      if (t === 'BEVERAGE') barItems.push(slim); else kitchenItems.push(slim);
    }

    const totalCount = await this.prisma.kitchenTicket.count({
      where: { order: { branchId: order.branchId } },
    });

    const tickets: any[] = [];
    let counter = totalCount;
    if (kitchenItems.length > 0) {
      counter += 1;
      tickets.push(await this.prisma.kitchenTicket.create({
        data: {
          orderId: order.id,
          stationId: kitchenStation.id,
          ticketNumber: `KOT-${String(counter).padStart(4, '0')}`,
          status: 'PENDING',
          items: kitchenItems,
          notes: order.notes,
        },
        include: {
          station: true,
          order: { select: { orderNumber: true, orderType: true, table: true } },
        },
      }));
    }
    if (barItems.length > 0) {
      counter += 1;
      tickets.push(await this.prisma.kitchenTicket.create({
        data: {
          orderId: order.id,
          stationId: barStation.id,
          ticketNumber: `BAR-${String(counter).padStart(4, '0')}`,
          status: 'PENDING',
          items: barItems,
          notes: order.notes,
        },
        include: {
          station: true,
          order: { select: { orderNumber: true, orderType: true, table: true } },
        },
      }));
    }

    for (const t of tickets) {
      this.server.to(`branch:${order.branchId}`).emit('newTicket', t);
    }
  }

  // Get all active tickets for a branch
  @SubscribeMessage('getActiveTickets')
  async handleGetActiveTickets(
    @MessageBody() data: { branchId: string; stationId?: string },
  ) {
    return this.prisma.kitchenTicket.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        order: { branchId: data.branchId },
        ...(data.stationId && { stationId: data.stationId }),
      },
      include: {
        order: { select: { orderNumber: true, orderType: true, table: true, createdAt: true } },
        station: true,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }
}
