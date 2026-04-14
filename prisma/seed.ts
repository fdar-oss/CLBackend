import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create tenant (no `plan` on Tenant — that lives on Subscription)
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'coffeelab' },
    update: {},
    create: {
      name: 'The Coffee Lab',
      slug: 'coffeelab',
      status: 'ACTIVE',
    },
  });
  console.log(`✅ Tenant: ${tenant.name} (${tenant.id})`);

  // Create main branch
  const branch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'BR-01' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Main Branch',
      code: 'BR-01',
      address: 'Lahore, Pakistan',
      isActive: true,
    },
  });
  console.log(`✅ Branch: ${branch.name} (${branch.id})`);

  // Create owner user — unique key is [tenantId, email]
  const hashedPassword = await bcrypt.hash('Admin@1234', 10);
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@coffeelab.pk' } },
    update: {},
    create: {
      tenantId: tenant.id,
      branchId: branch.id,
      email: 'admin@coffeelab.pk',
      passwordHash: hashedPassword,
      fullName: 'Admin User',
      role: 'TENANT_OWNER',
      isActive: true,
    },
  });
  console.log(`✅ User: ${user.fullName} / ${user.email}`);

  // Create menu categories — no @@unique([tenantId, name]), use findFirst+create pattern
  const catNames = ['Hot Beverages', 'Cold Beverages', 'Food'];
  const categories = await Promise.all(
    catNames.map(async (name, i) => {
      const existing = await prisma.menuCategory.findFirst({
        where: { tenantId: tenant.id, name },
      });
      if (existing) return existing;
      return prisma.menuCategory.create({
        data: { tenantId: tenant.id, name, sortOrder: i + 1, isActive: true },
      });
    }),
  );
  console.log(`✅ Categories: ${categories.map((c) => c.name).join(', ')}`);

  // Create sample menu items — field is `itemType`, no @@unique([tenantId, sku])
  const menuItemDefs = [
    { name: 'Espresso',   sku: 'ESP-001', basePrice: 250, itemType: 'BEVERAGE' as const, catIdx: 0, sortOrder: 1 },
    { name: 'Cappuccino', sku: 'CAP-001', basePrice: 450, itemType: 'BEVERAGE' as const, catIdx: 0, sortOrder: 2 },
    { name: 'Latte',      sku: 'LAT-001', basePrice: 500, itemType: 'BEVERAGE' as const, catIdx: 0, sortOrder: 3 },
    { name: 'Iced Latte', sku: 'ICL-001', basePrice: 550, itemType: 'BEVERAGE' as const, catIdx: 1, sortOrder: 1 },
    { name: 'Croissant',  sku: 'CRO-001', basePrice: 350, itemType: 'FOOD'     as const, catIdx: 2, sortOrder: 1 },
  ];

  const items = await Promise.all(
    menuItemDefs.map(async ({ name, sku, basePrice, itemType, catIdx, sortOrder }) => {
      const existing = await prisma.menuItem.findFirst({
        where: { tenantId: tenant.id, sku },
      });
      if (existing) return existing;
      return prisma.menuItem.create({
        data: {
          tenantId: tenant.id,
          categoryId: categories[catIdx].id,
          name,
          sku,
          basePrice,
          itemType,
          isActive: true,
          availablePOS: true,
          availableOnline: true,
          sortOrder,
        },
      });
    }),
  );
  console.log(`✅ Menu items: ${items.map((i) => i.name).join(', ')}`);

  // Create tables — number is String in schema ("T1", "T2", …)
  const tableNums = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
  await Promise.all(
    tableNums.map((num, idx) =>
      prisma.restaurantTable.upsert({
        where: { branchId_number: { branchId: branch.id, number: num } },
        update: {},
        create: {
          branchId: branch.id,
          number: num,
          section: idx < 3 ? 'Indoor' : 'Outdoor',
          capacity: 4,
          status: 'AVAILABLE',
          isActive: true,
        },
      }),
    ),
  );
  console.log(`✅ Tables: 6 tables (T1–T3 Indoor, T4–T6 Outdoor)`);

  console.log('\n🎉 Seed complete!\n');
  console.log('─────────────────────────────────');
  console.log('  Login credentials:');
  console.log('  Email:    admin@coffeelab.pk');
  console.log('  Password: Admin@1234');
  console.log('  URL:      http://localhost:3001');
  console.log('─────────────────────────────────');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
