import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve uploaded files as static assets
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // Security
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // API versioning
  app.enableVersioning({ type: VersioningType.URI, prefix: 'v', defaultVersion: '1' });

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global guards (JWT + Roles applied to all routes; use @Public() to skip)
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Coffee Lab Platform API')
    .setDescription('Restaurant ERP + POS + Marketing SaaS Platform')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Authentication & authorization')
    .addTag('Tenants', 'Tenant onboarding & management')
    .addTag('Branches', 'Branch management')
    .addTag('Users', 'User management')
    .addTag('Menu', 'Menu categories, items, modifiers')
    .addTag('POS', 'Point of sale orders & payments')
    .addTag('KDS', 'Kitchen Display System')
    .addTag('Inventory', 'Stock, recipes, movements')
    .addTag('Procurement', 'Vendors, POs, GRNs')
    .addTag('HR', 'Employees, attendance, payroll')
    .addTag('Finance', 'Expenses, daily summaries')
    .addTag('CRM', 'Customers, reservations, loyalty')
    .addTag('Marketing', 'Campaigns, segments, automation')
    .addTag('FBR', 'FBR POS integration — terminals, invoices, sync queue')
    .addTag('Website', 'Public website content')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`\n🚀 Coffee Lab API running on http://localhost:${port}`);
  console.log(`📚 Swagger docs at http://localhost:${port}/api/docs\n`);
}

bootstrap();
