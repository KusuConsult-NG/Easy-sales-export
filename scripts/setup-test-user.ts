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

async function setupTestUsers() {
    console.log("🧪 Setting up E2E test users...");

    const testUser = {
        email: "test-user@example.com",
        password: "TestPassword123!", // Note: This script doesn't handle Auth, only Firestore
        firstName: "Test",
        lastName: "User",
        role: "user",
        isVerified: true,
        serviceRegistrations: {
            wave: { status: "pending", submittedAt: FieldValue.serverTimestamp() },
            academy: { status: "none" },
            marketplace: { status: "none" },
            cooperatives: { status: "none" },
            export: { status: "none" }
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };

    const adminUser = {
        email: "test-admin@example.com",
        password: "AdminPassword123!",
        firstName: "Test",
        lastName: "Admin",
        role: "admin",
        isVerified: true,
        serviceRegistrations: {},
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };

    try {
        console.log("📝 Creating test-user in Firestore...");
        await db.collection("users").doc("test-user-id").set(testUser);
        
        console.log("📝 Creating test-admin in Firestore...");
        await db.collection("users").doc("test-admin-id").set(adminUser);
        
        // Also add to admin_users if your RBAC requires it
        await db.collection("admin_users").doc("test-admin-id").set({
            email: "test-admin@example.com",
            role: "super_admin",
            permissions: ["all"],
            updatedAt: FieldValue.serverTimestamp(),
        });

        console.log("✅ Test users provisioned successfully.");
        console.log("⚠️  Note: You must manually create these accounts in Firebase Auth with the same emails/passwords if they don't exist.");
    } catch (error) {
        console.error("❌ Failed to setup test users:", error);
    }
}

setupTestUsers().then(() => process.exit(0));
