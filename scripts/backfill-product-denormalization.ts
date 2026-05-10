import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function auditLegacyProducts() {
    console.log("Starting Denormalization Audit for Legacy Products...");
    
    try {
        const productsSnapshot = await db.collection(COLLECTIONS.PRODUCTS).get();
        console.log(`Found ${productsSnapshot.size} total products.`);
        
        const legacyProducts = productsSnapshot.docs.filter(doc => {
            const data = doc.data();
            return !data.sellerName || data.sellerName === "Easy Sales Seller";
        });
        
        console.log(`Identified ${legacyProducts.length} legacy/un-denormalized products.`);
        
        if (legacyProducts.length === 0) {
            console.log("Audit complete. All products are correctly denormalized.");
            return;
        }

        console.log("Beginning backfill process...");
        
        let successCount = 0;
        let failCount = 0;

        for (const doc of legacyProducts) {
            const productData = doc.data();
            
            // Map legacy farmer fields to standardized seller fields
            const sellerId = productData.sellerId || productData.farmerId;
            const sellerName = productData.sellerName || productData.farmerName || "Verified Seller";
            const sellerVerified = productData.sellerVerified ?? productData.isVerified ?? false;

            if (!sellerId) {
                console.warn(`Product ${doc.id} has no sellerId or farmerId. Skipping.`);
                failCount++;
                continue;
            }

            try {
                // Determine category - fallback to wholesale for legacy items
                let sellerCategory = productData.sellerCategory || "wholesale";

                // Attempt to enrich from seller_verifications (the new source of truth)
                const verificationDoc = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                    .where("userId", "==", sellerId)
                    .limit(1)
                    .get();
                
                const finalSellerName = sellerName;
                let finalVerified = sellerVerified;

                if (!verificationDoc.empty) {
                    const vData = verificationDoc.docs[0].data();
                    finalVerified = vData.status === "approved";
                    sellerCategory = vData.sellerCategory || "wholesale";
                }

                await doc.ref.update({
                    sellerId: sellerId, // Ensure it's set if it was farmerId
                    sellerName: finalSellerName,
                    sellerVerified: finalVerified,
                    sellerCategory: sellerCategory,
                    _version: 1, // Promote to versioned state
                    updatedAt: new Date()
                });

                successCount++;
                console.log(`[OK] Migrated/Updated product ${doc.id} (Seller: ${finalSellerName})`);
            } catch (err) {
                console.error(`[FAIL] Failed to update product ${doc.id}:`, err);
                failCount++;
            }
        }

        console.log("\n--- Audit Summary ---");
        console.log(`Successfully backfilled: ${successCount}`);
        console.log(`Failed/Skipped: ${failCount}`);
        console.log("----------------------");

    } catch (error) {
        console.error("Audit failed:", error);
    }
}

auditLegacyProducts();
