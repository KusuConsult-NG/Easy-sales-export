import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });

// Initialize Firebase Admin
if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
    });
}

const db = getFirestore();

async function seedCooperative() {
    try {
        console.log("🌱 Starting cooperative seed...");

        // Cooperative ID and details
        const cooperativeId = "coop-ezichi-farmers";
        const cooperativeData = {
            id: cooperativeId,
            name: "Ezichi Farmers Cooperative",
            description: "A cooperative society for farmers in the Easy Sales Export community",
            memberCount: 0,
            totalSavings: 0,
            totalLoans: 0,
            monthlyTarget: 50000,
            interestRate: 5, // 5% annual interest
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            status: "active",
        };

        // Create the cooperative
        console.log(`📝 Creating cooperative: ${cooperativeData.name}...`);
        await db.collection("cooperatives").doc(cooperativeId).set(cooperativeData);
        console.log("✅ Cooperative created successfully");

        // Ask for user email to add them as a member
        console.log("\n🔍 To add you as a member, we need your user email.");
        console.log("Please run this script with your email as an argument:");
        console.log("Example: npm run seed:cooperative your-email@example.com");

        // Check if email was provided as argument
        const userEmail = process.argv[2];

        if (!userEmail) {
            console.log("\n⚠️  No email provided. Cooperative created but no member added.");
            console.log("Run the script again with your email to join the cooperative.");
            return;
        }

        // Find user by email
        console.log(`\n🔍 Finding user with email: ${userEmail}...`);
        const usersSnapshot = await db.collection("users").where("email", "==", userEmail).limit(1).get();

        if (usersSnapshot.empty) {
            console.log(`❌ No user found with email: ${userEmail}`);
            console.log("Please make sure you've registered an account with this email.");
            return;
        }

        const userDoc = usersSnapshot.docs[0];
        const userId = userDoc.id;
        console.log(`✅ Found user: ${userId}`);

        // Add user as member with initial savings
        const initialSavings = 10000; // ₦10,000 initial savings
        console.log(`\n💰 Adding you as member with ₦${initialSavings.toLocaleString()} initial savings...`);

        await db.collection("cooperatives").doc(cooperativeId).collection("members").doc(userId).set({
            userId,
            balance: initialSavings,
            loanBalance: 0,
            joinedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Update cooperative totals
        await db.collection("cooperatives").doc(cooperativeId).update({
            memberCount: FieldValue.increment(1),
            totalSavings: FieldValue.increment(initialSavings),
        });

        // Update user document with cooperativeId
        console.log("📝 Updating user profile...");
        await db.collection("users").doc(userId).update({
            cooperativeId,
            updatedAt: FieldValue.serverTimestamp(),
        });

        console.log("\n✅ SUCCESS! You are now a member of the Ezichi Farmers Cooperative");
        console.log(`💰 Your initial savings: ₦${initialSavings.toLocaleString()}`);
        console.log(`🎯 Monthly target: ₦${cooperativeData.monthlyTarget.toLocaleString()}`);
        console.log("\n🚀 Visit /cooperatives to see your membership!");

    } catch (error) {
        console.error("❌ Error seeding cooperative:", error);
        process.exit(1);
    }
}

seedCooperative()
    .then(() => {
        console.log("\n✨ Seed complete!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
