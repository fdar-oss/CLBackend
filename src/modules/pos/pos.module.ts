import { Module } from '@nestjs/common';
import { PosService } from './pos.service';
import { PosController } from './pos.controller';
import { AuditService } from '../../common/services/audit.service';

@Module({
  controllers: [PosController],
  providers: [PosService, AuditService],
  exports: [PosService],
})
export class PosModule {}
