import { db } from "../src/lib/firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

async function generateCSV() {
    console.log("Fetching data from Firebase...");

    // 1. Fetch all members
    const memSnap = await db.collection("cooperative_members").get();
    
    // 2. Fetch all completed payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();

    // 3. Optional: Fetch USERS collection to map missing names/emails for orphaned payments
    // We'll collect all user IDs first
    const allUserIds = new Set<string>();
    memSnap.docs.forEach(doc => {
        allUserIds.add(doc.data().userId || doc.id);
    });
    paymentsSnap.docs.forEach(doc => {
        allUserIds.add(doc.data().userId);
    });

    console.log(`Extracting profile details from ${allUserIds.size} potential users...`);
    
    // Bulk fetch users is hard in Firestore, so we'll just fetch them directly 
    // or rely on Auth if we need to. For simplicity, we'll fetch from `users` collection in chunks.
    const userProfiles = new Map<string, any>();
    const userIdsArray = Array.from(allUserIds).filter(Boolean);
    
    // Split into chunks of 30 for 'in' query
    for (let i = 0; i < userIdsArray.length; i += 30) {
        const chunk = userIdsArray.slice(i, i + 30);
        if (chunk.length === 0) continue;
        
        try {
            const usersSnap = await db.collection("users").where(FieldPath.documentId(), "in", chunk).get();
            usersSnap.docs.forEach(doc => {
                userProfiles.set(doc.id, doc.data());
            });
        } catch(e) {
            // Ignore error if 'users' collection schema differs
        }
    }

    const records: any[] = [];
    const paidUserIds = new Set<string>();
    
    // Process payments first to identify who paid
    paymentsSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.userId) paidUserIds.add(d.userId);
    });

    const memUserIds = new Set<string>();

    // Process all 575 Application Forms
    memSnap.docs.forEach(doc => {
        const d = doc.data();
        const uid = d.userId || doc.id;
        memUserIds.add(uid);
        
        const profile = userProfiles.get(uid) || {};
        
        records.push({
            "User ID": uid,
            "First Name": d.firstName || profile.firstName || "-",
            "Last Name": d.lastName || profile.lastName || "-",
            "Email": d.email || profile.email || "-",
            "Phone Number": d.phone || profile.phone || "-",
            "Has Submitted Application": "Yes",
            "Has Completed Payment": paidUserIds.has(uid) ? "Yes" : "No",
            "Application Status": d.membershipStatus || d.status || "pending",
            "Payment Reference": d.paymentReference || "-"
        });
    });

    // Process Orphaned Payments (Paid but NO Application Form)
    paymentsSnap.docs.forEach(doc => {
        const d = doc.data();
        const uid = d.userId;
        
        if (uid && !memUserIds.has(uid)) {
            const profile = userProfiles.get(uid) || {};
            
            records.push({
                "User ID": uid,
                "First Name": profile.firstName || "-",
                "Last Name": profile.lastName || "-",
                "Email": profile.email || d.customerEmail || d.email || "-",
                "Phone Number": profile.phone || d.phone || "-",
                "Has Submitted Application": "No (Orphaned Payment)",
                "Has Completed Payment": "Yes",
                "Application Status": "No Form Submitted",
                "Payment Reference": d.reference || d.trxref || "-"
            });
        }
    });

    // Generate CSV string
    console.log(`Writing ${records.length} records to CSV...`);
    
    const headers = [
        "User ID", "First Name", "Last Name", "Email", "Phone Number", 
        "Has Submitted Application", "Has Completed Payment", 
        "Application Status", "Payment Reference"
    ];
    
    const csvRows = [];
    csvRows.push(headers.join(","));
    
    for (const row of records) {
        const values = headers.map(header => {
            const val = row[header] ? String(row[header]).replace(/"/g, '""') : "";
            return `"${val}"`;
        });
        csvRows.push(values.join(","));
    }
    
    const csvContent = csvRows.join("\n");
    const outputPath = path.join(process.cwd(), "cooperative_member_reconciliation.csv");
    
    fs.writeFileSync(outputPath, csvContent);
    console.log(`✅ Successfully saved CSV with ${records.length} total users to: ${outputPath}`);
}

generateCSV().catch(console.error).finally(() => process.exit(0));
