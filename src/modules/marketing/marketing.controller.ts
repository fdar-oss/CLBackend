import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MarketingService } from './marketing.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Marketing')
@ApiBearerAuth()
@Controller('marketing')
export class MarketingController {
  constructor(private svc: MarketingService) {}

  // Segments
  @Post('segments') createSegment(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createSegment(u.tenantId, body);
  }
  @Get('segments') getSegments(@CurrentUser() u: JwtPayload) {
    return this.svc.getSegments(u.tenantId);
  }
  @Post('segments/:id/calculate')
  @ApiOperation({ summary: 'Re-evaluate segment membership based on rules' })
  calculateSegment(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.calculateSegment(u.tenantId, id);
  }

  // Campaigns
  @Post('campaigns') createCampaign(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createCampaign(u.tenantId, u.sub, body);
  }
  @Get('campaigns') getCampaigns(@CurrentUser() u: JwtPayload) {
    return this.svc.getCampaigns(u.tenantId);
  }
  @Post('campaigns/:id/schedule')
  @ApiOperation({ summary: 'Schedule campaign for a future datetime' })
  scheduleCampaign(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.svc.scheduleCampaign(u.tenantId, id, new Date(body.scheduledAt));
  }
  @Post('campaigns/:id/send-now')
  @ApiOperation({ summary: 'Send campaign immediately' })
  sendNow(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.svc.sendCampaignNow(u.tenantId, id);
  }
  @Get('campaigns/:id/stats') getCampaignStats(@Param('id') id: string) {
    return this.svc.getCampaignStats(id);
  }

  // Templates
  @Post('templates') createTemplate(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createTemplate(u.tenantId, body);
  }
  @Get('templates') getTemplates(@CurrentUser() u: JwtPayload) {
    return this.svc.getTemplates(u.tenantId);
  }

  // Channels (WhatsApp, SMS, Email config)
  @Post('channels')
  @ApiOperation({ summary: 'Configure a marketing channel (WhatsApp WATI, SMS, Email)' })
  saveChannel(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.saveChannel(u.tenantId, body);
  }
  @Get('channels') getChannels(@CurrentUser() u: JwtPayload) {
    return this.svc.getChannels(u.tenantId);
  }

  // Automations
  @Post('automations') createAutomation(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.svc.createAutomation(u.tenantId, body);
  }
  @Get('automations') getAutomations(@CurrentUser() u: JwtPayload) {
    return this.svc.getAutomations(u.tenantId);
  }
  @Patch('automations/:id/toggle')
  toggleAutomation(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.svc.toggleAutomation(u.tenantId, id, body.isActive);
  }
}
