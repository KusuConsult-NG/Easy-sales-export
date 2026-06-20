import * as fs from "fs";
import * as admin from "firebase-admin";

function loadEnv(filePath: string) {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    content.split("\n").forEach(line => {
        const parts = line.split("=");
        if (parts.length >= 2) {
            const key = parts[0].trim();
            let val = parts.slice(1).join("=").trim();
            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
            if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
            process.env[key] = val;
        }
    });
}

loadEnv(".env.local");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();

async function main() {
    const userId = "Oibs95AwmAbNYimMN1wcVOsimRl1";
    console.log(`Checking details for User ID: ${userId}...`);

    // 1. Fetch user document
    const userDoc = await db.collection("users").doc(userId).get();
    console.log("User details:", JSON.stringify(userDoc.data(), null, 2));
    
    // 2. Fetch all academy courses
    const coursesSnap = await db.collection("academy_courses").get();
    console.log(`\nTotal courses in academy_courses collection: ${coursesSnap.size}`);
    coursesSnap.docs.forEach(doc => {
        const data = doc.data();
        console.log(`Course ID: ${doc.id} | Title: ${data.title} | Tier: ${data.tier || "free"} | Modules count: ${data.modules?.length || 0}`);
        if (data.modules) {
            data.modules.forEach((mod: any, i: number) => {
                console.log(`  - Module ${i + 1}: ${mod.title} (${mod.lessons?.length || 0} lessons)`);
            });
        }
    });
    
    // 3. Fetch user's progress in collections/subcollections
    console.log("\n--- USER PROGRESS IN course_progress COLLECTION ---");
    const progressSnap = await db.collection("course_progress").where("userId", "==", userId).get();
    console.log(`Progress docs count: ${progressSnap.size}`);
    progressSnap.docs.forEach(doc => {
        console.log(`Doc ID: ${doc.id} | CourseID: ${doc.data().courseId} | Percent: ${doc.data().completionPercentage ?? doc.data().progressPercent ?? 0} | Completed: ${doc.data().completed}`);
    });
    
    console.log("\n--- USER PROGRESS IN user_progress SUBCOLLECTION ---");
    const userProgressSubSnap = await db.collection(`user_progress/${userId}/courses`).get();
    console.log(`user_progress subcollection docs count: ${userProgressSubSnap.size}`);
    userProgressSubSnap.docs.forEach(doc => {
        console.log(`SubDoc ID: ${doc.id} | Progress: ${doc.data().overallProgress}`);
    });

    console.log("\n--- USER ENROLLMENTS IN course_enrollments ---");
    const enrollmentsSnap = await db.collection("course_enrollments").where("userId", "==", userId).get();
    console.log(`Enrollments count: ${enrollmentsSnap.size}`);
    enrollmentsSnap.docs.forEach(doc => {
        console.log(`Enrollment ID: ${doc.id} | CourseID: ${doc.data().courseId} | Status: ${doc.data().status}`);
    });
}

main().catch(console.error);
