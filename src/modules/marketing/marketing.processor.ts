import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('marketing')
export class MarketingProcessor {
  private readonly logger = new Logger(MarketingProcessor.name);

  constructor(private prisma: PrismaService) {}

  @Process('sendCampaign')
  async handleSendCampaign(job: Job<{ campaignId: string }>) {
    const { campaignId } = job.data;
    this.logger.log(`Processing campaign ${campaignId}`);

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        segment: { include: { members: { include: { customer: true } } } },
      },
    });

    if (!campaign) {
      this.logger.warn(`Campaign ${campaignId} not found`);
      return;
    }

    // Get recipients from segment or all opted-in customers
    let recipients: any[] = [];
    if (campaign.segmentId && campaign.segment) {
      recipients = campaign.segment.members.map(m => m.customer);
    } else {
      recipients = await this.prisma.customer.findMany({
        where: {
          tenantId: campaign.tenantId,
          isActive: true,
          ...(campaign.channel === 'WHATSAPP' && { optInWhatsapp: true }),
          ...(campaign.channel === 'EMAIL' && { optInEmail: true }),
          ...(campaign.channel === 'SMS' && { optInSms: true }),
        },
      });
    }

    // Create send records
    if (recipients.length > 0) {
      await this.prisma.campaignSend.createMany({
        data: recipients.map(r => ({ campaignId, customerId: r.id, status: 'QUEUED' })),
        skipDuplicates: true,
      });
    }

    // Queue individual sends in batches
    for (const recipient of recipients) {
      await this.sendMessage(campaign, recipient).catch(err => {
        this.logger.warn(`Failed to send to ${recipient.id}: ${err.message}`);
      });
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        sentCount: recipients.length,
      },
    });

    this.logger.log(`Campaign ${campaignId} sent to ${recipients.length} recipients`);
  }

  private async sendMessage(campaign: any, recipient: any) {
    const body = this.renderTemplate(campaign.body, recipient);

    // Get channel config for this tenant
    const channel = await this.prisma.marketingChannel.findFirst({
      where: { tenantId: campaign.tenantId, type: campaign.channel, isActive: true },
    });

    if (!channel) {
      this.logger.warn(`No active ${campaign.channel} channel for tenant ${campaign.tenantId}`);
      return;
    }

    const config = channel.config as any;

    // Route to appropriate provider
    switch (campaign.channel) {
      case 'WHATSAPP':
        await this.sendWhatsApp(config, recipient.whatsappNumber || recipient.phone, body);
        break;
      case 'SMS':
        await this.sendSms(config, recipient.phone, body);
        break;
      case 'EMAIL':
        await this.sendEmail(config, recipient.email, campaign.subject || campaign.name, body);
        break;
    }

    await this.prisma.campaignSend.updateMany({
      where: { campaignId: campaign.id, customerId: recipient.id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }

  private renderTemplate(template: string, customer: any): string {
    return template
      .replace(/\{\{firstName\}\}/g, customer.fullName?.split(' ')[0] || 'Valued Customer')
      .replace(/\{\{fullName\}\}/g, customer.fullName || 'Valued Customer')
      .replace(/\{\{phone\}\}/g, customer.phone || '')
      .replace(/\{\{email\}\}/g, customer.email || '');
  }

  private async sendWhatsApp(config: any, phone: string, message: string) {
    if (!phone || !config?.apiToken) return;
    // WATI API call
    const axios = require('axios');
    await axios.post(
      `${config.apiUrl}/api/sendSessionMessage/${phone}`,
      { messageText: message },
      { headers: { Authorization: `Bearer ${config.apiToken}` } },
    );
  }

  private async sendSms(config: any, phone: string, message: string) {
    if (!phone) return;
    this.logger.log(`SMS to ${phone}: ${message.substring(0, 30)}...`);
    // Integrate with Twilio or local SMS gateway here
  }

  private async sendEmail(config: any, email: string, subject: string, body: string) {
    if (!email) return;
    this.logger.log(`Email to ${email}: ${subject}`);
    // Integrate with Nodemailer/SendGrid here
  }
}
