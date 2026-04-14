import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('marketing') private marketingQueue: Queue,
  ) {}

  // ─── Segments ────────────────────────────────────────────────────────────────

  async createSegment(tenantId: string, data: any) {
    return this.prisma.customerSegment.create({ data: { tenantId, ...data } });
  }

  async getSegments(tenantId: string) {
    return this.prisma.customerSegment.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async calculateSegment(tenantId: string, segmentId: string) {
    const segment = await this.prisma.customerSegment.findFirst({
      where: { id: segmentId, tenantId },
    });
    if (!segment) throw new NotFoundException('Segment not found');

    // Build dynamic query from rules
    const customers = await this.evaluateSegmentRules(tenantId, segment.rules as any[]);

    // Replace members
    await this.prisma.$transaction(async (tx) => {
      await tx.customerSegmentMember.deleteMany({ where: { segmentId } });
      if (customers.length > 0) {
        await tx.customerSegmentMember.createMany({
          data: customers.map(c => ({ segmentId, customerId: c.id })),
          skipDuplicates: true,
        });
      }
      await tx.customerSegment.update({
        where: { id: segmentId },
        data: { memberCount: customers.length, lastCalculatedAt: new Date() },
      });
    });

    return { segmentId, memberCount: customers.length };
  }

  private async evaluateSegmentRules(tenantId: string, rules: any[]) {
    // Simple rule evaluation — can be extended to a full DSL
    const where: any = { tenantId, isActive: true };

    for (const rule of rules) {
      switch (rule.field) {
        case 'totalSpent':
          where.totalSpent = this.buildNumericFilter(rule.op, rule.value);
          break;
        case 'visitCount':
          where.visitCount = this.buildNumericFilter(rule.op, rule.value);
          break;
        case 'lastVisitDaysAgo':
          const cutoff = new Date(Date.now() - rule.value * 86400000);
          where.lastVisitAt = rule.op === 'gte' ? { lte: cutoff } : { gte: cutoff };
          break;
        case 'source':
          where.source = rule.value;
          break;
        case 'optInWhatsapp':
          where.optInWhatsapp = rule.value;
          break;
        case 'optInEmail':
          where.optInEmail = rule.value;
          break;
      }
    }

    return this.prisma.customer.findMany({ where, select: { id: true } });
  }

  private buildNumericFilter(op: string, value: number) {
    switch (op) {
      case 'gte': return { gte: value };
      case 'lte': return { lte: value };
      case 'gt': return { gt: value };
      case 'lt': return { lt: value };
      case 'eq': return value;
      default: return { gte: value };
    }
  }

  // ─── Campaigns ───────────────────────────────────────────────────────────────

  async createCampaign(tenantId: string, userId: string, data: any) {
    return this.prisma.campaign.create({
      data: { tenantId, createdById: userId, ...data },
    });
  }

  async getCampaigns(tenantId: string) {
    return this.prisma.campaign.findMany({
      where: { tenantId },
      include: { segment: { select: { name: true, memberCount: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async scheduleCampaign(tenantId: string, campaignId: string, scheduledAt: Date) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
    if (!campaign) throw new NotFoundException('Campaign not found');

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'SCHEDULED', scheduledAt },
    });

    // Queue the campaign send
    const delay = scheduledAt.getTime() - Date.now();
    await this.marketingQueue.add('sendCampaign', { campaignId }, {
      delay: Math.max(0, delay),
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    return { message: 'Campaign scheduled', scheduledAt };
  }

  async sendCampaignNow(tenantId: string, campaignId: string) {
    await this.marketingQueue.add('sendCampaign', { campaignId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'SENDING' },
    });
    return { message: 'Campaign queued for immediate sending' };
  }

  // ─── Templates ───────────────────────────────────────────────────────────────

  async createTemplate(tenantId: string, data: any) {
    return this.prisma.campaignTemplate.create({ data: { tenantId, ...data } });
  }

  async getTemplates(tenantId: string) {
    return this.prisma.campaignTemplate.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // ─── Channels ────────────────────────────────────────────────────────────────

  async saveChannel(tenantId: string, data: any) {
    const existing = await this.prisma.marketingChannel.findFirst({
      where: { tenantId, type: data.type },
    });
    if (existing) {
      return this.prisma.marketingChannel.update({
        where: { id: existing.id },
        data: { config: data.config, name: data.name, isActive: data.isActive ?? true },
      });
    }
    return this.prisma.marketingChannel.create({ data: { tenantId, ...data } });
  }

  async getChannels(tenantId: string) {
    const channels = await this.prisma.marketingChannel.findMany({
      where: { tenantId },
    });
    // Mask sensitive keys in response
    return channels.map(c => ({
      ...c,
      config: this.maskConfig(c.config as any),
    }));
  }

  // ─── Automation Rules ─────────────────────────────────────────────────────────

  async createAutomation(tenantId: string, data: any) {
    return this.prisma.automationRule.create({ data: { tenantId, ...data } });
  }

  async getAutomations(tenantId: string) {
    return this.prisma.automationRule.findMany({ where: { tenantId } });
  }

  async toggleAutomation(tenantId: string, id: string, isActive: boolean) {
    return this.prisma.automationRule.update({ where: { id }, data: { isActive } });
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  async getCampaignStats(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    const breakdown = await this.prisma.campaignSend.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: true,
    });
    return { campaign, breakdown };
  }

  private maskConfig(config: Record<string, any>) {
    const masked = { ...config };
    const sensitiveKeys = ['apiToken', 'apiKey', 'password', 'secret', 'authToken'];
    for (const key of sensitiveKeys) {
      if (masked[key]) masked[key] = '••••••••';
    }
    return masked;
  }
}
