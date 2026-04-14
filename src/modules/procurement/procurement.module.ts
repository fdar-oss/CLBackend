import { Module } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { ProcurementController } from './procurement.controller';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [ProcurementController],
  providers: [ProcurementService],
})
export class ProcurementModule {}
