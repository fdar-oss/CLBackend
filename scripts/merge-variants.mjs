// Merge "Item (Small)" + "Item (Large)" pairs into parent with variants
// Usage: node scripts/merge-variants.mjs

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

async function run() {
  const login = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD, deviceInfo: 'script' });
  token = login.accessToken;
  console.log('✓ Logged in');

  const items = await api('GET', '/menu/items');
  console.log(`Found ${items.length} items`);

  // Find pairs
  const smallItems = items.filter(i => i.name.endsWith(' (Small)'));
  let merged = 0;

  for (const small of smallItems) {
    const baseName = small.name.replace(' (Small)', '');
    const large = items.find(i => i.name === `${baseName} (Large)` && i.categoryId === small.categoryId);

    if (!large) {
      console.log(`  ⚠ No Large for "${baseName}" — renaming Small to parent`);
      await api('PATCH', `/menu/items/${small.id}`, { name: baseName });
      // Create single "Regular" variant
      await api('POST', `/menu/items/${small.id}/variants/bulk`, {
        variants: [{ name: 'Regular', price: Number(small.basePrice) }],
      });
      continue;
    }

    // 1. Rename Small → parent name
    await api('PATCH', `/menu/items/${small.id}`, { name: baseName });

    // 2. Create variants on the parent (Small item becomes parent)
    await api('POST', `/menu/items/${small.id}/variants/bulk`, {
      variants: [
        { name: 'Small', price: Number(small.basePrice) },
        { name: 'Large', price: Number(large.basePrice) },
      ],
    });

    // 3. Delete the old Large item (it's now a variant)
    try {
      await api('DELETE', `/menu/items/${large.id}`);
    } catch (err) {
      // If it has order history, just deactivate it
      console.log(`  ⚠ Could not delete Large item "${large.name}" (has order history) — deactivating`);
      await api('PATCH', `/menu/items/${large.id}/toggle`);
    }

    console.log(`  ✓ ${baseName}: Small ₨${small.basePrice} / Large ₨${large.basePrice}`);
    merged++;
  }

  // Count final state
  const after = await api('GET', '/menu/items');
  console.log(`\n✅ Done. ${merged} pairs merged. Menu now has ${after.length} items (was ${items.length}).`);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
