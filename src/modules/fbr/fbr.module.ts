import { Module } from '@nestjs/common';
import { FbrService } from './fbr.service';
import { FbrController } from './fbr.controller';

@Module({
  controllers: [FbrController],
  providers: [FbrService],
  exports: [FbrService],
})
export class FbrModule {}
