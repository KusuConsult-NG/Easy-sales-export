
import { registerForBriefingAction } from "../src/app/actions/briefing";
import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Starting WAVE Briefing Registration Flow Verification...");

    // 1. Valid Registration
    const testEmail = `test.briefing.${Date.now()}@example.com`;
    console.log(`\n1. Testing valid registration for ${testEmail}...`);

    const validData = {
        fullName: "Verification Bot",
        email: testEmail,
        phoneNumber: "08012345678",
        state: "Lagos",
        role: "Investor"
    };

    try {
        const result1 = await registerForBriefingAction(validData);
        if (result1.success) {
            console.log("✅ Registration successful");
        } else {
            console.error("❌ Registration failed:", result1.error);
            process.exit(1);
        }

        // 2. Verify Data in Firestore
        console.log("\n2. Verifying Firestore data consistency...");
        // Wait a moment for Firestore (though it's usually immediate for same-instance)
        await new Promise(r => setTimeout(r, 1000));

        const snapshot = await db.collection("wave_briefing_registrations")
            .where("email", "==", testEmail)
            .limit(1)
            .get();

        if (snapshot.empty) {
            console.error("❌ FAILED: Document not found in Firestore");
            process.exit(1);
        } else {
            const doc = snapshot.docs[0].data();
            console.log("Document found:", doc);

            // Check specific fields
            const checks = [
                doc.status === "registered",
                !!doc.createdAt,
                !!doc.updatedAt,
                doc.fullName === validData.fullName,
                doc.attended === false
            ];

            if (checks.every(Boolean)) {
                console.log("✅ Data integrity verified (Schema matches Phase 5 requirements)");
            } else {
                console.error("❌ Data integrity check failed. Doc:", doc);
                process.exit(1);
            }
        }

        // 3. Duplicate Registration
        console.log("\n3. Testing duplicate registration prevention...");
        const result2 = await registerForBriefingAction(validData);
        if (!result2.success && result2.error?.includes("already registered")) {
            console.log("✅ Duplicate registration correctly blocked");
        } else {
            console.error("❌ Duplicate registration check failed:", result2);
            process.exit(1);
        }

        // Cleanup
        console.log("\n4. Cleaning up test data...");
        await db.collection("wave_briefing_registrations").doc(snapshot.docs[0].id).delete();
        console.log("✅ Cleanup complete");

    } catch (error) {
        console.error("❌ Unexpected error:", error);
        process.exit(1);
    }
}

main();
