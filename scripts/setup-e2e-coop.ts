import dotenv from "dotenv";
import path from "path";
import * as fs from "fs";

// Load local environment config files
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../.env.production.local") });

import { db, adminAuth } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

const USERS_TO_SEED = [
    {
        email: "e2e.user@easysalesexport.test",
        password: "E2eTest@2024!",
        firstName: "E2E",
        lastName: "Testuser",
        fullName: "E2E Testuser",
        phone: "08099999901",
        roles: ["general_user", "cooperative_member"],
        serviceRegistrations: {
            cooperative: {
                status: "active",
                paymentStatus: "completed",
                approvedAt: new Date()
            },
            cooperatives: {
                status: "active",
                paymentStatus: "completed",
                approvedAt: new Date()
            }
        }
    },
    {
        email: "e2e.admin@easysalesexport.test",
        password: "E2eAdmin@2024!",
        firstName: "E2E",
        lastName: "Admin",
        fullName: "E2E Admin",
        phone: "08099999902",
        roles: ["admin", "general_user"],
        serviceRegistrations: {}
    },
    {
        email: "e2e.buyer@easysalesexport.test",
        password: "E2eBuyer@2024!",
        firstName: "E2E",
        lastName: "Buyer",
        fullName: "E2E Buyer",
        phone: "08099999903",
        roles: ["buyer", "general_user"],
        serviceRegistrations: {
            marketplace: {
                status: "approved",
                paymentStatus: "completed",
                appliedAt: new Date(),
                approvedAt: new Date()
            }
        }
    },
    {
        email: "e2e.seller@easysalesexport.test",
        password: "E2eSeller@2024!",
        firstName: "E2E",
        lastName: "Seller",
        fullName: "E2E Seller",
        phone: "08099999904",
        roles: ["seller", "general_user"],
        serviceRegistrations: {
            marketplace: {
                status: "approved",
                paymentStatus: "completed",
                appliedAt: new Date(),
                approvedAt: new Date()
            }
        }
    }
];

async function clearCollection(collectionName: string) {
    try {
        const snap = await db.collection(collectionName).get();
        if (snap.empty) return;
        const batch = db.batch();
        snap.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`Cleared collection: ${collectionName} (${snap.size} docs)`);
    } catch (err: any) {
        console.warn(`Warning clearing collection ${collectionName}:`, err.message);
    }
}

async function setupE2EUsers() {
    console.log("Starting provisioning of all 4 E2E users...");

    // Clear loan applications to prevent double-lending check failure on re-runs
    await clearCollection("loan_applications");
    await clearCollection("cooperative_loans");

    const userUids: Record<string, string> = {};

    for (const u of USERS_TO_SEED) {
        console.log(`\n---------------------------------------------\nProcessing E2E user: ${u.email}...`);

        const formattedPhone = `+234${u.phone.replace(/^0/, "")}`;
        const phoneFormats = [u.phone, formattedPhone];

        // 1. Delete conflicting Auth users by email
        try {
            const existingAuthByEmail = await adminAuth.getUserByEmail(u.email);
            console.log(`Deleting existing Auth user by email: ${u.email} (UID: ${existingAuthByEmail.uid})`);
            await adminAuth.deleteUser(existingAuthByEmail.uid);
        } catch (err: any) {
            if (err.code !== "auth/user-not-found") {
                console.warn(`Warning deleting Auth user by email: ${err.message}`);
            }
        }

        // 2. Delete conflicting Auth users by phone number
        for (const p of phoneFormats) {
            try {
                const existingAuthByPhone = await adminAuth.getUserByPhoneNumber(p);
                console.log(`Deleting existing Auth user by phone: ${p} (UID: ${existingAuthByPhone.uid})`);
                await adminAuth.deleteUser(existingAuthByPhone.uid);
            } catch (err: any) {
                if (err.code !== "auth/user-not-found") {
                    console.warn(`Warning deleting Auth user by phone ${p}: ${err.message}`);
                }
            }
        }

        // 3. Delete conflicting Firestore user documents by email
        try {
            const emailSnap = await db.collection("users").where("email", "==", u.email).get();
            for (const doc of emailSnap.docs) {
                console.log(`Deleting conflicting Firestore user document by email (ID: ${doc.id})`);
                await doc.ref.delete();
            }
        } catch (err: any) {
            console.warn(`Warning deleting Firestore user document by email: ${err.message}`);
        }

        // Delete conflicting WAVE applications by email
        try {
            const waveSnap = await db.collection("wave_applications").where("userEmail", "==", u.email).get();
            for (const doc of waveSnap.docs) {
                console.log(`Deleting conflicting WAVE application (ID: ${doc.id})`);
                await doc.ref.delete();
            }
        } catch (err: any) {
            console.warn(`Warning deleting conflicting WAVE application: ${err.message}`);
        }

        // 4. Delete conflicting Firestore user documents by phone
        for (const p of phoneFormats) {
            try {
                const phoneSnap = await db.collection("users").where("phone", "==", p).get();
                for (const doc of phoneSnap.docs) {
                    console.log(`Deleting conflicting Firestore user document by phone ${p} (ID: ${doc.id})`);
                    await doc.ref.delete();
                }
            } catch (err: any) {
                console.warn(`Warning deleting Firestore user document by phone ${p}: ${err.message}`);
            }
        }

        // 5. Create fresh Auth user
        let authUser;
        try {
            authUser = await adminAuth.createUser({
                email: u.email,
                emailVerified: true,
                password: u.password,
                displayName: u.fullName,
                phoneNumber: formattedPhone
            });
            console.log(`Successfully created clean Auth user ${u.email} (UID: ${authUser.uid})`);
        } catch (err: any) {
            console.error(`CRITICAL: Failed to create Auth user ${u.email}:`, err);
            throw err;
        }

        const uid = authUser.uid;
        userUids[u.email] = uid;

        // 6. Create Firestore user document
        const userRef = db.collection("users").doc(uid);
        const userData = {
            uid,
            firstName: u.firstName,
            lastName: u.lastName,
            fullName: u.fullName,
            email: u.email,
            phone: formattedPhone,
            gender: "Female",
            roles: u.roles,
            serviceRegistrations: u.serviceRegistrations,
            profileComplete: true,
            verified: true,
            isVerified: true,
            onboardingCompleted: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await userRef.set(userData);
        console.log(`Successfully created Firestore users document for ${u.email}`);

        // 7. If cooperative member, create cooperative_members document
        if (u.roles.includes("cooperative_member")) {
            const coopMembersColl = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);

            // Clean up existing coop member documents by userId, email, or phone
            try {
                const coopUserIdSnap = await coopMembersColl.where("userId", "==", uid).get();
                for (const doc of coopUserIdSnap.docs) {
                    await doc.ref.delete();
                }
                const coopEmailSnap = await coopMembersColl.where("email", "==", u.email).get();
                for (const doc of coopEmailSnap.docs) {
                    await doc.ref.delete();
                }
                for (const p of phoneFormats) {
                    const coopPhoneSnap = await coopMembersColl.where("phone", "==", p).get();
                    for (const doc of coopPhoneSnap.docs) {
                        await doc.ref.delete();
                    }
                }
            } catch (err: any) {
                console.warn(`Warning cleaning up coop member documents: ${err.message}`);
            }

            const coopData = {
                userId: uid,
                firstName: u.firstName,
                lastName: u.lastName,
                email: u.email,
                phone: formattedPhone,
                gender: "Female",
                paymentStatus: "completed",
                membershipStatus: "active",
                status: "active",
                amountPaid: 10000,
                membershipTier: "Member",
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await coopMembersColl.doc(uid).set(coopData);
            console.log(`Successfully created cooperative_members document for ${u.email}`);
        }

        // 8. Clear Redis Cache
        const cacheKey = `cooperative:member:${uid}`;
        try {
            const { redis } = await import("../src/lib/redis");
            await redis.del(cacheKey);
            await redis.del(`user:profile:${uid}`);
            console.log(`Cleared Redis cache keys for ${uid}`);
        } catch (cacheErr) {
            // Redis might not be running or configured in this context
        }
    }

    // 9. Seed E2E delivered order for dispute/confirm receipt flow testing
    const buyerUid = userUids["e2e.buyer@easysalesexport.test"];
    const sellerUid = userUids["e2e.seller@easysalesexport.test"];
    if (buyerUid && sellerUid) {
        console.log("\nSeeding E2E delivered order for dispute testing...");
        const ordersColl = db.collection("marketplaceOrders");
        
        // Clean old E2E orders
        const oldOrdersSnap = await ordersColl.where("buyerId", "==", buyerUid).get();
        for (const doc of oldOrdersSnap.docs) {
            await doc.ref.delete();
        }
        
        const productsSnap = await db.collection("products").where("status", "==", "active").limit(1).get();
        let productId = "sample-product-yam";
        let productTitle = "Premium Nigerian Yams";
        if (!productsSnap.empty) {
            productId = productsSnap.docs[0].id;
            productTitle = productsSnap.docs[0].data().title || productsSnap.docs[0].data().name || "Premium Nigerian Yams";
        }
        
        const orderId = "ORD-E2E-DELIVERED";
        const orderData = {
            id: orderId,
            orderId: orderId,
            orderNumber: "ORD-E2E-0001",
            buyerId: buyerUid,
            sellerId: sellerUid,
            productIds: [productId],
            items: [
                {
                    productId: productId,
                    productTitle: productTitle,
                    quantity: 2,
                    unitPrice: 150000,
                    totalPrice: 300000,
                    tier: "invalid_tier"
                }
            ],
            subtotal: 300000,
            deliveryFee: 5000,
            serviceFee: 0,
            totalAmount: 305000,
            deliveryAddress: {
                recipientName: "E2E Buyer",
                recipientPhone: "+2348099999903",
                street: "123 E2E Shipping Way",
                city: "Lagos",
                state: "Lagos",
                lga: "Lagos Island"
            },
            paymentMethod: "escrow",
            paymentStatus: "escrow_held",
            status: "delivered",
            buyerConfirmed: false,
            escrowReleased: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            _version: 1
        };
        
        await ordersColl.doc(orderId).set(orderData);
        console.log(`✅ Seeded delivered order ${orderId} for buyer ${buyerUid}`);
    }

    console.log("\n✅ E2E user provisioning completed successfully!");
}

setupE2EUsers().then(() => process.exit(0)).catch((err) => {
    console.error("Failed to setup E2E users:", err);
    process.exit(1);
});
