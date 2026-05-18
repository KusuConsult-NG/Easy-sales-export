import { db } from "../src/lib/firebase-admin";

async function investigateAcademyUsers() {
    const users = await db.collection("users").where("serviceRegistrations.academy.paymentStatus", "==", "completed").get();
    console.log(`Found ${users.size} users with completed academy payment status.`);
    
    const userIds = [];
    users.docs.forEach(doc => {
        userIds.push(doc.id);
        const data = doc.data();
        console.log(`User: ${doc.id}, Name: ${data.firstName} ${data.lastName}, Email: ${data.email}, Plan: ${data.serviceRegistrations?.academy?.plan}`);
    });
    
    console.log("\nChecking academy_applications for these users...");
    const apps = await db.collection("academy_applications").get();
    
    const appUsers = new Set();
    apps.docs.forEach(doc => {
        const app = doc.data();
        if (userIds.includes(app.userId)) {
            appUsers.add(app.userId);
            console.log(`App found for ${app.userId}. PaymentStatus: ${app.paymentStatus}, Amount: ${app.paymentAmount}`);
        }
    });

    userIds.forEach(uid => {
        if (!appUsers.has(uid)) {
            console.log(`MISSING APP FOR USER: ${uid}`);
        }
    });
}

investigateAcademyUsers().catch(console.error);
