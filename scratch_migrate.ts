import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  })
});

const db = getFirestore();

async function run() {
  console.log("Starting legacy product schema migration...");
  const snapshot = await db.collection('products').get();
  
  console.log(`Found ${snapshot.size} products in database.`);
  
  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(`\nMigrating Product: "${data.name || data.title}" (ID: ${doc.id})`);
    
    const updateData: any = {};
    
    // 1. Upgrade status from 'available' or missing to 'active'
    if (data.status === 'available' || !data.status) {
      updateData.status = 'active';
      console.log(`- status: "${data.status || 'missing'}" -> "active"`);
    }
    
    // 2. Title field sync (Zod expects 'title', database might have 'name')
    if (data.name && !data.title) {
      updateData.title = data.name;
      console.log(`- title: (synced from name: "${data.name}")`);
    }

    // 3. Pricing tiers construction
    if (!data.pricingTiers || data.pricingTiers.length === 0) {
      const price = data.price || 0;
      updateData.pricingTiers = [{ type: 'retail', price: price, minQuantity: 1 }];
      console.log(`- pricingTiers: constructed retail tier with price ₦${price.toLocaleString()}`);
    }

    // 4. Available stock sync
    if (!data.availableQuantity || data.availableQuantity === 0) {
      const stock = data.quantity || 100;
      updateData.availableQuantity = stock;
      console.log(`- availableQuantity: ${data.availableQuantity || 0} -> ${stock} (synced from quantity)`);
    }

    // 5. Unit fallback
    if (!data.unit) {
      updateData.unit = 'kg';
      console.log(`- unit: "kg" (fallback)`);
    }

    // 6. Metadata fallbacks
    if (data.views === undefined) updateData.views = 0;
    if (data.orders === undefined) updateData.orders = 0;
    if (data.rating === undefined) updateData.rating = 0;
    if (data.reviewCount === undefined) updateData.reviewCount = 0;

    // Apply update if any changes made
    if (Object.keys(updateData).length > 0) {
      updateData.updatedAt = FieldValue.serverTimestamp();
      await doc.ref.update(updateData);
      console.log("✔ Product successfully migrated!");
    } else {
      console.log("✔ Product already aligns with the new schema.");
    }
  }
  
  console.log("\nMigration completed successfully!");
}

run().catch(console.error);
