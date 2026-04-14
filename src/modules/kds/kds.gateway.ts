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
      include: { station: true, order: { select: { branchId: true, orderNumber: true } } },
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
    // Get all stations for this branch
    const stations = await this.prisma.kitchenStation.findMany({
      where: { branchId: order.branchId, isActive: true },
    });

    if (!stations.length) return;

    // For now, send all items to the first station (can be enhanced to route by item type)
    const defaultStation = stations[0];
    const count = await this.prisma.kitchenTicket.count({
      where: { order: { branchId: order.branchId } },
    });
    const ticketNumber = `KOT-${String(count + 1).padStart(4, '0')}`;

    const ticket = await this.prisma.kitchenTicket.create({
      data: {
        orderId: order.id,
        stationId: defaultStation.id,
        ticketNumber,
        status: 'PENDING',
        items: order.orderItems.map((i: any) => ({
          name: i.itemName,
          quantity: i.quantity,
          notes: i.notes,
          modifiers: i.modifiers?.map((m: any) => m.modifierName) || [],
        })),
        notes: order.notes,
      },
      include: {
        station: true,
        order: { select: { orderNumber: true, orderType: true, table: true } },
      },
    });

    // Broadcast to branch KDS screens
    this.server.to(`branch:${order.branchId}`).emit('newTicket', ticket);
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
