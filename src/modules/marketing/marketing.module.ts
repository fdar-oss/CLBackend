import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MarketingService } from './marketing.service';
import { MarketingController } from './marketing.controller';
import { MarketingProcessor } from './marketing.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'marketing' }),
  ],
  controllers: [MarketingController],
  providers: [MarketingService, MarketingProcessor],
  exports: [MarketingService],
})
export class MarketingModule {}
