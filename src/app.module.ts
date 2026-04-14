import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { BranchesModule } from './modules/branches/branches.module';
import { UsersModule } from './modules/users/users.module';
import { MenuModule } from './modules/menu/menu.module';
import { PosModule } from './modules/pos/pos.module';
import { KdsModule } from './modules/kds/kds.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { HrModule } from './modules/hr/hr.module';
import { FinanceModule } from './modules/finance/finance.module';
import { CrmModule } from './modules/crm/crm.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { FbrModule } from './modules/fbr/fbr.module';

@Module({
  imports: [
    // Global config — all modules can inject ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Global event emitter — powers @OnEvent() across POS, Inventory, Finance, KDS
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

    // Cron jobs — FBR sync retries, payroll reminders, etc.
    ScheduleModule.forRoot(),

    // BullMQ / Redis — marketing campaigns, FBR retry queue
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
        },
      }),
    }),

    // Global Prisma — available in every module without importing PrismaModule
    PrismaModule,

    // Feature modules
    AuthModule,
    TenantsModule,
    BranchesModule,
    UsersModule,
    MenuModule,
    PosModule,
    KdsModule,
    InventoryModule,
    ProcurementModule,
    HrModule,
    FinanceModule,
    CrmModule,
    MarketingModule,
    FbrModule,
  ],
})
export class AppModule {}
