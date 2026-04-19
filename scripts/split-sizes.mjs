// Split sized drinks into separate Small/Large items with correct prices
// Usage: node scripts/split-sizes.mjs

const API = 'http://localhost:4000/v1';
const EMAIL = 'admin@coffeelab.pk';
const PASSWORD = 'Admin@1234';
let token = null;

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) };
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// Correct Large prices from the PDF menus
const LARGE_PRICES = {
  // Hot Coffee
  'Cappuccino': 699, 'Latte': 699, 'Mocha': 799, 'Americano': 599,
  'Espresso Shot': 499, 'Hot Chocolate': 699, 'Spanish Latte': 799,
  'Caramel Latte': 799, 'Hazelnut Latte': 799, 'French Vanilla Latte': 799,
  'Irish Latte': 799, 'Butterscotch Latte': 799,
  // Iced Coffee
  'Ice Americano': 599, 'Lab Special Ice Latte': 799, 'French Vanilla Ice Latte': 799,
  'Caramel Ice Latte': 799, 'Hazelnut Ice Latte': 799, 'Irish Ice Latte': 799,
  'Butterscotch Ice Latte': 799, 'Spanish Ice Latte': 799, 'Shaken Espresso': 799,
  // Matcha
  'Hot Matcha': 799, 'Ice Matcha': 799, 'Strawberry Ice Matcha': 999, 'Blueberry Ice Matcha': 999,
  // Tea
  'Special Tea': 549, 'Karak Tea': 449, 'Doodh Patti': 449,
  'Cardamom Tea': 449, 'Kashmiri Tea': 499,
  // Thirst Quenchers
  'Spanish Margarita': 599, 'Apple Mint Cooler': 899, 'Peach Margarita': 799,
  'Lemon Mint Mojito': 599, 'Pina Colada': 899,
  // Bubble Tea
  'Honey Dew Bubble Tea': 899, 'Mango Bubble Tea': 899, 'Banana Bubble Tea': 899,
  'Watermelon Bubble Tea': 899, 'Taro Bubble Tea': 899, 'Blueberry Bubble Tea': 899,
  'Strawberry Bubble Tea': 899, 'Green Apple Bubble Tea': 899, 'Pineapple Bubble Tea': 899,
  'Peach Bubble Tea': 899, 'Raspberry Bubble Tea': 899,
  // Ice Cream Frappe
  'Frappuccino': 799, 'Mocha Frappe': 799, 'Cookies & Cream Frappe': 899,
  'Cream Brulee Frappe': 899, 'Cocoa Loco': 799, 'Irish Frappe': 799,
  'Hazelnut Frappe': 799, 'Butterscotch Frappe': 799,
  // Ice Cream Shakes
  'Death by Chocolate': 899, 'Vanilla Shake': 899, 'Caramel Shake': 899,
  'Strawberry Shake': 899, 'Mix Berries Shake': 999, 'Oreo Delight Shake': 999,
  'KitKat Shake': 999, 'Lotus Shake': 999, 'Coconut Shake': 899,
};

async function run() {
  // Login
  const login = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD, deviceInfo: 'script' });
  token = login.accessToken;
  console.log('✓ Logged in');

  // Get all items
  const items = await api('GET', '/menu/items');
  console.log(`Found ${items.length} items`);

  // Find the Size modifier group
  const modGroups = await api('GET', '/menu/modifier-groups');
  const sizeGroup = modGroups.find(g => g.name === 'Size');
  if (!sizeGroup) { console.log('No "Size" modifier group found — nothing to do.'); return; }
  console.log(`Size group ID: ${sizeGroup.id}`);

  // Find Coffee Add-ons group (keep this one)
  const addonsGroup = modGroups.find(g => g.name === 'Coffee Add-ons');
  const addonsId = addonsGroup?.id;

  let split = 0, skipped = 0;

  for (const item of items) {
    const hasSizeGroup = item.modifierGroups?.some(mg => mg.modifierGroup?.name === 'Size');
    if (!hasSizeGroup) { skipped++; continue; }

    const largePrice = LARGE_PRICES[item.name];
    if (!largePrice) {
      console.log(`  ⚠ No large price mapping for "${item.name}" — skipping`);
      skipped++;
      continue;
    }

    // Determine which other modifier groups to keep (e.g. Coffee Add-ons)
    const keepModGroupIds = (item.modifierGroups || [])
      .filter(mg => mg.modifierGroup?.name !== 'Size')
      .map(mg => mg.modifierGroup?.id || mg.modifierGroupId);

    // 1. Rename current item to "(Small)" and remove Size group
    await api('PATCH', `/menu/items/${item.id}`, {
      name: `${item.name} (Small)`,
      modifierGroupIds: keepModGroupIds,
    });

    // 2. Create new "(Large)" item in same category
    await api('POST', '/menu/items', {
      name: `${item.name} (Large)`,
      description: item.description,
      basePrice: largePrice,
      itemType: item.itemType,
      categoryId: item.categoryId,
      availablePOS: item.availablePOS,
      availableOnline: item.availableOnline,
      sortOrder: item.sortOrder + 0.5,
      modifierGroupIds: keepModGroupIds,
    });

    split++;
    if (split % 10 === 0) console.log(`  ✓ ${split} items split…`);
  }

  console.log(`\n✅ Done. ${split} items split into Small+Large. ${skipped} unchanged.`);
  console.log('The "Size" modifier group can now be deleted from the Modifiers tab.');
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
