import * as admin from 'firebase-admin';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!admin.apps.length) {
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        console.error("❌ Missing Firebase credentials in .env.local (need FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)");
        process.exit(1);
    }
    
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
        });
        console.log("✅ Firebase Admin initialized.");
    } catch (e) {
        console.error("❌ Failed to initialize Firebase Admin", e);
        process.exit(1);
    }
}

const db = admin.firestore();

async function migrateLegacyAdvancedTier() {
    console.log("🔍 Scanning for users with legacy 'advanced' Academy tier...");
    let updatedCount = 0;
    
    try {
        const usersSnap = await db.collection("users").get();
        const batch = db.batch();
        let batchCount = 0;

        usersSnap.forEach((doc) => {
            const data = doc.data();
            const academyPlan = data?.serviceRegistrations?.academy?.plan;

            if (academyPlan === "advanced") {
                batch.update(doc.ref, {
                    "serviceRegistrations.academy.plan": "standard",
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                batchCount++;
                updatedCount++;
            }

            // Execute batch if limit reached
            if (batchCount === 400) {
                batch.commit();
                batchCount = 0;
            }
        });

        if (batchCount > 0) {
            await batch.commit();
        }

        console.log(`✅ Migrated ${updatedCount} users from 'advanced' to 'standard' tier.`);
    } catch (error) {
        console.error("❌ Error migrating users:", error);
    }
}

async function initializeAcademyCourses() {
    console.log("🔍 Checking default Academy Courses...");
    
    const courses = [
        {
            title: "Foundation Program",
            description: "30-day program providing basic training and foundational knowledge required for export business.",
            instructor: "Easy Sales Export Team",
            duration: "30 days",
            level: "beginner",
            tier: "foundation",
            price: 25000, // Or whatever default is, standard was 50000 
            modules: [],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        {
            title: "Standard Program",
            description: "60-day program including Foundation plus local/international market access and LLC incorporation details.",
            instructor: "Easy Sales Export Team",
            duration: "60 days",
            level: "intermediate",
            tier: "standard",
            price: 50000,
            modules: [],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        {
            title: "Elite Program",
            description: "90-day program with direct mentorship, all standard features, and USA/UK/Canada incorporation help.",
            instructor: "Easy Sales Export Team",
            duration: "90 days",
            level: "advanced",
            tier: "elite",
            price: 100000,
            modules: [],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }
    ];

    try {
        const coursesRef = db.collection("academy_courses");
        
        for (const defaultCourse of courses) {
            const querySnap = await coursesRef.where("tier", "==", defaultCourse.tier).limit(1).get();
            if (querySnap.empty) {
                console.log(`Missing ${defaultCourse.tier} course. Creating...`);
                await coursesRef.add(defaultCourse);
            } else {
                console.log(`✅ ${defaultCourse.tier} course already exists.`);
            }
        }
    } catch (error) {
        console.error("❌ Error initializing courses:", error);
    }
}

async function main() {
    console.log("🚀 Starting Firebase Schema & Data Fixes for Academy...");
    await migrateLegacyAdvancedTier();
    await initializeAcademyCourses();
    console.log("🎉 All fixes applied successfully.");
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
