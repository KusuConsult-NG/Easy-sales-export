import { config } from "dotenv";
config({ path: ".env.local" });
import { getAdminDb } from "../src/lib/firebase-admin";

async function checkLogs() {
    const db = getAdminDb();
    
    console.log("Checking BROADCAST_LOGS...");
    const logs = await db.collection("broadcast_logs").orderBy("sentAt", "desc").limit(5).get();
    logs.docs.forEach(doc => {
        const d = doc.data();
        console.log(`[${d.sentAt?.toDate()}] Status: ${d.status}, Audience: ${d.audience}, Sent: ${d.successCount}, Failed: ${d.failCount}`);
    });
    
    console.log("\nChecking ERROR logs in AUDIT_LOGS...");
    const auditLogs = await db.collection("audit_logs")
        .orderBy("timestamp", "desc")
        .limit(20)
        .get();
        
    auditLogs.docs.forEach(doc => {
        const d = doc.data();
        if (d.metadata?.error || d.error || d.status === "error" || d.action.includes("error") || d.action.includes("fail")) {
            console.log(`[${d.timestamp?.toDate()}] Action: ${d.action}, Error:`, d.metadata?.error || d.error);
        }
    });
}

checkLogs().then(() => process.exit(0)).catch(console.error);
