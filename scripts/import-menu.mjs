// One-shot menu import — runs against the local backend at :4000
// Usage: node scripts/import-menu.mjs

const API = 'http://localhost:4000/v1';
const EMAIL = 'admin@coffeelab.pk';
const PASSWORD = 'Admin@1234';

let token = null;

async function api(method, path, body, isMultipart = false) {
  const headers = { ...(token && { Authorization: `Bearer ${token}` }) };
  if (!isMultipart) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? (isMultipart ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === 'object' ? JSON.stringify(data) : data;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

async function login() {
  const res = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD, deviceInfo: 'import-script' });
  token = res.accessToken;
  console.log(`✓ Logged in as ${res.user.fullName}`);
}

// ─── Data ────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { name: 'Hot Coffee',         sortOrder: 1 },
  { name: 'Iced Coffee',        sortOrder: 2 },
  { name: 'Matcha',             sortOrder: 3 },
  { name: 'Tea',                sortOrder: 4 },
  { name: 'Thirst Quenchers',   sortOrder: 5 },
  { name: 'Bubble Tea',         sortOrder: 6 },
  { name: 'Ice Cream Frappe',   sortOrder: 7 },
  { name: 'Ice Cream Shakes',   sortOrder: 8 },
  { name: 'Salad',              sortOrder: 9 },
  { name: 'Bagel',              sortOrder: 10 },
  { name: 'Sandwich',           sortOrder: 11 },
  { name: 'Burger',             sortOrder: 12 },
  { name: 'Breakfast',          sortOrder: 13 },
  { name: 'Croissant Sandwich', sortOrder: 14 },
];

const MODIFIER_GROUPS = [
  {
    name: 'Size',
    selectionType: 'SINGLE',
    isRequired: true,
    minSelections: 1,
    modifiers: [
      { name: 'Small', priceAdjustment: 0, sortOrder: 0 },
      { name: 'Large', priceAdjustment: 100, sortOrder: 1 },
    ],
  },
  {
    name: 'Coffee Add-ons',
    selectionType: 'MULTIPLE',
    isRequired: false,
    minSelections: 0,
    modifiers: [
      { name: 'Add Flavor',      priceAdjustment: 299, sortOrder: 0 },
      { name: 'Add Extra Shot',  priceAdjustment: 299, sortOrder: 1 },
    ],
  },
];

// itemType = BEVERAGE (drinks) or FOOD
// modGroupKeys = which modifier groups to attach (resolved to ids after creation)
const ITEMS = [
  // ─── Hot Coffee ─────────────────────────────────────────────────────────
  { cat: 'Hot Coffee', name: 'Cappuccino',          basePrice: 599, description: 'Rich espresso, steamed milk and frothy foam — strong with a smooth, airy finish.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Hot Coffee', name: 'Latte',               basePrice: 599, description: 'Espresso and steamed milk, finished with a light layer of foam.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Hot Coffee', name: 'Mocha',               basePrice: 699, description: 'Chocolate, espresso and steamed milk — sweet, smooth and crave-worthy.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Hot Coffee', name: 'Americano',           basePrice: 499, description: 'Bold espresso mellowed with hot water — aromatic with a satisfying finish.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Hot Coffee', name: 'Espresso Shot',       basePrice: 399, description: 'A bold, concentrated shot — intense, smooth and full of flavor.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Hot Coffee', name: 'Hot Chocolate',       basePrice: 599, description: 'Premium cocoa and steamed milk, topped with frothy foam.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Hot Coffee', name: 'Spanish Latte',       basePrice: 699, description: 'Espresso with steamed milk and condensed milk — creamy and perfectly sweet.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Hot Coffee', name: 'Caramel Latte',       basePrice: 699, description: 'Espresso with steamed milk and rich caramel — luxurious and aromatic.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Hot Coffee', name: 'Hazelnut Latte',      basePrice: 699, description: 'Bold espresso with steamed milk and aromatic hazelnut syrup.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Hot Coffee', name: 'French Vanilla Latte',basePrice: 699, description: 'Espresso, steamed milk and French vanilla — creamy, sweet perfection.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Hot Coffee', name: 'Irish Latte',         basePrice: 699, description: 'Espresso meets creamy milk with a hint of Irish cream — subtly sweet.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Hot Coffee', name: 'Butterscotch Latte',  basePrice: 699, description: 'Bold espresso and steamed milk with golden butterscotch syrup.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },

  // ─── Iced Coffee ────────────────────────────────────────────────────────
  { cat: 'Iced Coffee', name: 'Ice Americano',            basePrice: 499, description: 'Chilled espresso over ice — crisp, bold and perfectly refreshing.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Iced Coffee', name: 'Lab Special Ice Latte',    basePrice: 699, description: 'Espresso, cold milk, chocolate sauce and caramel sauce over ice.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Iced Coffee', name: 'French Vanilla Ice Latte', basePrice: 699, description: 'Espresso, milk and French vanilla syrup over ice — sweet and creamy.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Iced Coffee', name: 'Caramel Ice Latte',        basePrice: 699, description: 'Bold espresso with cold milk and luscious caramel over ice.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Iced Coffee', name: 'Hazelnut Ice Latte',       basePrice: 699, description: 'Espresso and cold milk with aromatic hazelnut syrup over ice.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Iced Coffee', name: 'Irish Ice Latte',          basePrice: 699, description: 'Fresh espresso, cold milk and Irish syrup — smooth with a twist.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Iced Coffee', name: 'Butterscotch Ice Latte',   basePrice: 699, description: 'Espresso with creamy milk and rich butterscotch syrup over ice.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Iced Coffee', name: 'Spanish Ice Latte',        basePrice: 699, description: 'Espresso, cold milk and condensed milk over ice — creamy and sweet.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },
  { cat: 'Iced Coffee', name: 'Shaken Espresso',          basePrice: 699, description: 'Freshly brewed espresso vigorously shaken over ice — vibrant and frothy.', itemType: 'BEVERAGE', mods: ['Size', 'Coffee Add-ons'] },

  // ─── Matcha ─────────────────────────────────────────────────────────────
  { cat: 'Matcha', name: 'Hot Matcha',             basePrice: 699, description: 'Ceremonial matcha with velvety steamed milk — silky and subtly sweet.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Matcha', name: 'Ice Matcha',             basePrice: 699, description: 'Smooth matcha poured over ice with cold milk — refreshing and earthy.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Matcha', name: 'Strawberry Ice Matcha',  basePrice: 899, description: 'Earthy matcha meets sweet strawberry over ice — vibrant and refreshing.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Matcha', name: 'Blueberry Ice Matcha',   basePrice: 899, description: 'Matcha blended with fresh blueberry over ice — fruity, bold and smooth.', itemType: 'BEVERAGE', mods: ['Size'] },

  // ─── Tea ────────────────────────────────────────────────────────────────
  { cat: 'Tea', name: 'Special Tea',  basePrice: 449, description: 'Our signature house blend — bold, aromatic and perfectly brewed.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Tea', name: 'Karak Tea',    basePrice: 349, description: 'A strong, spiced brew simmered with milk — rich and comforting.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Tea', name: 'Doodh Patti',  basePrice: 349, description: 'Classic milk tea simmered to perfection — simple and soul-warming.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Tea', name: 'Cardamom Tea', basePrice: 349, description: 'Fragrant cardamom-infused tea — aromatic, warm and soothing.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Tea', name: 'Kashmiri Tea', basePrice: 399, description: 'Pink tea with pistachios and almonds — delicate and subtly sweet.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Tea', name: 'Green Tea',    basePrice: 349, description: 'Light, clean and refreshing — pure and naturally soothing.', itemType: 'BEVERAGE', mods: [] },

  // ─── Thirst Quenchers ───────────────────────────────────────────────────
  { cat: 'Thirst Quenchers', name: 'Spanish Margarita',  basePrice: 499, description: 'Fresh lime and citrus shaken to perfection — zesty and vibrant.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Thirst Quenchers', name: 'Apple Mint Cooler',  basePrice: 699, description: 'Cool, fruity and minty — the ultimate thirst-quencher.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Thirst Quenchers', name: 'Peach Margarita',    basePrice: 699, description: 'Peach and fresh lime over ice with a hint of citrus zest.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Thirst Quenchers', name: 'Lemon Mint Mojito',  basePrice: 499, description: 'Fresh lemon, mint and soda water — cool, zesty and invigorating.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Thirst Quenchers', name: 'Pina Colada',        basePrice: 699, description: 'Pineapple, coconut cream and ice — smooth, creamy and tropical.', itemType: 'BEVERAGE', mods: ['Size'] },

  // ─── Bubble Tea (all S 799 / L 899) ─────────────────────────────────────
  { cat: 'Bubble Tea', name: 'Honey Dew Bubble Tea',   basePrice: 799, description: 'Sweet honeydew, creamy and refreshing.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Bubble Tea', name: 'Mango Bubble Tea',       basePrice: 799, description: 'Tropical mango, luscious and fruity.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Bubble Tea', name: 'Banana Bubble Tea',      basePrice: 799, description: 'Creamy banana, sweet and satisfying.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Bubble Tea', name: 'Watermelon Bubble Tea',  basePrice: 799, description: 'Light, sweet and refreshing.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Bubble Tea', name: 'Taro Bubble Tea',        basePrice: 799, description: 'Earthy taro, creamy and subtly sweet.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Bubble Tea', name: 'Blueberry Bubble Tea',   basePrice: 799, description: 'Vibrant, fruity and bold.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Bubble Tea', name: 'Strawberry Bubble Tea',  basePrice: 799, description: 'Sweet strawberry, smooth and fruity.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Bubble Tea', name: 'Green Apple Bubble Tea', basePrice: 799, description: 'Crisp, tangy and perfectly sweet.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Bubble Tea', name: 'Pineapple Bubble Tea',   basePrice: 799, description: 'Bright, tropical and refreshing.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Bubble Tea', name: 'Peach Bubble Tea',       basePrice: 799, description: 'Smooth, sweet and gently fragrant.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Bubble Tea', name: 'Raspberry Bubble Tea',   basePrice: 799, description: 'Tart, vibrant and wonderfully fruity.', itemType: 'BEVERAGE', mods: ['Size'] },

  // ─── Ice Cream Frappe ───────────────────────────────────────────────────
  { cat: 'Ice Cream Frappe', name: 'Frappuccino',           basePrice: 699, description: 'Espresso, milk, ice and vanilla ice cream — rich, creamy and bold.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Frappe', name: 'Mocha Frappe',          basePrice: 699, description: 'Espresso and ice cream blended into a smooth chocolate frappe.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Frappe', name: 'Cookies & Cream Frappe',basePrice: 749, description: 'Espresso and ice cream crushed with Oreo cookies — indulgent and smooth.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Frappe', name: 'Cream Brulee Frappe',   basePrice: 699, description: 'Caramelized sugar and vanilla richness topped with a fresh espresso shot.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Frappe', name: 'Cocoa Loco',            basePrice: 699, description: 'Rich chocolate blend, smooth and sweet with a fresh espresso shot.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Frappe', name: 'Irish Frappe',          basePrice: 699, description: 'Bold Irish flavor and smooth sweetness — a refreshing pick-me-up.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Frappe', name: 'Hazelnut Frappe',       basePrice: 699, description: 'Creamy blend with roasted hazelnut aroma and a fresh espresso shot.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Frappe', name: 'Butterscotch Frappe',   basePrice: 699, description: 'Golden butterscotch flavor — sweet, smooth and irresistibly comforting.', itemType: 'BEVERAGE', mods: ['Size'] },

  // ─── Ice Cream Shakes ───────────────────────────────────────────────────
  { cat: 'Ice Cream Shakes', name: 'Death by Chocolate',  basePrice: 699, description: 'An irresistible chocolate shake packed with rich flavor in every sip.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Shakes', name: 'Vanilla Shake',       basePrice: 699, description: 'Classic vanilla blended to perfection — smooth, creamy and satisfying.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Shakes', name: 'Caramel Shake',       basePrice: 699, description: 'Rich caramel blended to perfection — smooth, creamy and satisfying.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Shakes', name: 'Strawberry Shake',    basePrice: 699, description: 'Sweet strawberry blended to perfection — smooth, creamy and satisfying.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Shakes', name: 'Mix Berries Shake',   basePrice: 899, description: 'Creamy shake bursting with the sweetness and tang of mixed berries.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Shakes', name: 'Oreo Delight Shake',  basePrice: 899, description: 'Creamy ice cream blended with crunchy Oreos, topped with chocolate drizzle.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Shakes', name: 'KitKat Shake',        basePrice: 899, description: 'Ice cream and KitKat pieces — creamy, chocolatey and deliciously crunchy.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Shakes', name: 'Lotus Shake',         basePrice: 799, description: 'Ice cream with Lotus Biscoff spread, caramel drizzle and crushed cookies.', itemType: 'BEVERAGE', mods: ['Size'] },
  { cat: 'Ice Cream Shakes', name: 'Coconut Shake',       basePrice: 799, description: 'Creamy ice cream blended with pina coco — tropical and refreshingly sweet.', itemType: 'BEVERAGE', mods: ['Size'] },

  // ─── Salad ──────────────────────────────────────────────────────────────
  { cat: 'Salad', name: 'Sunrise Harvest Salad', basePrice: 850, description: 'Garden veggies in a light honey-lemon dressing.', itemType: 'FOOD', mods: [] },
  { cat: 'Salad', name: 'Crispy Crunch Salad',   basePrice: 950, description: 'Roasted nuts, fresh veggies and tender chicken.', itemType: 'FOOD', mods: [] },

  // ─── Bagel ──────────────────────────────────────────────────────────────
  { cat: 'Bagel', name: 'Urban Bite Bagel',   basePrice: 1250, description: 'Scrambled eggs and savory turkey slices.', itemType: 'FOOD', mods: [] },
  { cat: 'Bagel', name: 'Morning Bliss Bagel',basePrice: 1100, description: 'Poached egg, cream cheese and a hint of honey.', itemType: 'FOOD', mods: [] },

  // ─── Sandwich ───────────────────────────────────────────────────────────
  { cat: 'Sandwich', name: 'Regal Melt Sandwich',     basePrice: 1650, description: 'Tender beef and gooey cheese on toasted sourdough.', itemType: 'FOOD', mods: [] },
  { cat: 'Sandwich', name: 'Golden Parmesan Sandwich',basePrice: 1250, description: 'Grilled chicken, parmesan and fresh greens.', itemType: 'FOOD', mods: [] },
  { cat: 'Sandwich', name: 'Arctic Bite',             basePrice: 950,  description: 'Fresh veggies stacked with creamy mayo.', itemType: 'FOOD', mods: [] },

  // ─── Burger ─────────────────────────────────────────────────────────────
  { cat: 'Burger', name: 'Red Heat Slider',           basePrice: 950,  description: 'Spicy chicken with smoky mayo.', itemType: 'FOOD', mods: [] },
  { cat: 'Burger', name: 'Grill Beef Slider',         basePrice: 950,  description: 'Grilled beef with melted cheese and tangy sauce.', itemType: 'FOOD', mods: [] },
  { cat: 'Burger', name: 'The Lab Melted Beef Burger',basePrice: 1450, description: 'Caramelized onions, melted cheese and lab sauce.', itemType: 'FOOD', mods: [] },
  { cat: 'Burger', name: 'Latin Fire Burger',         basePrice: 1450, description: 'Tandoori burger with tender chicken — spicy and smoky.', itemType: 'FOOD', mods: [] },

  // ─── Breakfast ──────────────────────────────────────────────────────────
  { cat: 'Breakfast', name: 'Breakfast Board',           basePrice: 1850, description: 'Beans, mushrooms, scrambled eggs, pancakes and fresh bread.', itemType: 'FOOD', mods: [] },
  { cat: 'Breakfast', name: 'Egg Benedict',              basePrice: 1275, description: 'Poached eggs on a soft muffin with velvety hollandaise.', itemType: 'FOOD', mods: [] },
  { cat: 'Breakfast', name: 'Spanish Omelette',          basePrice: 950,  description: 'Eggs, potatoes and onions cooked in olive oil.', itemType: 'FOOD', mods: [] },
  { cat: 'Breakfast', name: 'Mushroom Sunrise Omelette', basePrice: 1150, description: 'Fluffy eggs with mushrooms, tomatoes and cheese.', itemType: 'FOOD', mods: [] },
  { cat: 'Breakfast', name: 'Velvet Cheese Omelette',    basePrice: 1100, description: 'Creamy melted cheese with eggs and butter.', itemType: 'FOOD', mods: [] },

  // ─── Croissant Sandwich ─────────────────────────────────────────────────
  { cat: 'Croissant Sandwich', name: 'Croissant Lab Supreme',     basePrice: 1450, description: 'Chicken, turkey bacon and melted cheese.', itemType: 'FOOD', mods: [] },
  { cat: 'Croissant Sandwich', name: 'Morning Croissant Special', basePrice: 1250, description: 'Scrambled eggs with smoked chicken and cheese.', itemType: 'FOOD', mods: [] },
  { cat: 'Croissant Sandwich', name: 'Croissant Ham & Cheese',    basePrice: 1350, description: 'Poached egg with savory ham and cheese.', itemType: 'FOOD', mods: [] },
];

// ─── Run ─────────────────────────────────────────────────────────────────────

async function run() {
  await login();

  // Categories
  console.log('\nCreating categories…');
  const catIds = {};
  for (const c of CATEGORIES) {
    const created = await api('POST', '/menu/categories', c);
    catIds[c.name] = created.id;
    console.log(`  ✓ ${c.name}`);
  }

  // Modifier groups
  console.log('\nCreating modifier groups…');
  const modIds = {};
  for (const g of MODIFIER_GROUPS) {
    const created = await api('POST', '/menu/modifier-groups', g);
    modIds[g.name] = created.id;
    console.log(`  ✓ ${g.name} (${g.modifiers.length} options)`);
  }

  // Items
  console.log(`\nCreating ${ITEMS.length} items…`);
  let count = 0;
  let failed = 0;
  for (const it of ITEMS) {
    try {
      await api('POST', '/menu/items', {
        name: it.name,
        description: it.description,
        basePrice: it.basePrice,
        itemType: it.itemType,
        categoryId: catIds[it.cat],
        availablePOS: true,
        availableOnline: false,
        sortOrder: count,
        modifierGroupIds: it.mods.map((n) => modIds[n]).filter(Boolean),
      });
      count++;
      if (count % 10 === 0) console.log(`  ✓ ${count}/${ITEMS.length}…`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${it.name}: ${err.message}`);
    }
  }

  console.log(`\n✅ Done. ${count}/${ITEMS.length} items created. ${failed} failed.`);
}

run().catch((err) => {
  console.error('\n❌ Import failed:', err.message);
  process.exit(1);
});
