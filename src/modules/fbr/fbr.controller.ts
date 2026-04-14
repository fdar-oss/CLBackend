import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FbrService } from './fbr.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('FBR')
@ApiBearerAuth()
@Controller('fbr')
export class FbrController {
  constructor(private fbrService: FbrService) {}

  @Post('terminals')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Register an FBR POS terminal for a branch' })
  registerTerminal(@Body() body: any) {
    return this.fbrService.registerTerminal(body.branchId, {
      terminalId: body.terminalId,
      terminalName: body.terminalName,
      posId: body.posId,
    });
  }

  @Get('terminals/:branchId')
  @ApiOperation({ summary: 'List FBR terminals for a branch' })
  getTerminals(@Param('branchId') branchId: string) {
    return this.fbrService.getTerminals(branchId);
  }

  @Post('submit/:orderId')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Manually submit an order invoice to FBR' })
  submitInvoice(@CurrentUser() u: JwtPayload, @Param('orderId') orderId: string) {
    return this.fbrService.submitInvoice(orderId, u.tenantId);
  }

  @Get('sync-queue')
  @Roles(UserRole.TENANT_OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'View FBR sync queue (failed/pending submissions)' })
  getSyncQueue(@CurrentUser() u: JwtPayload) {
    return this.fbrService.getSyncQueue(u.tenantId);
  }
}
