
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { getCleanBroadcastList } from "../src/lib/broadcast-logic";

async function testNewSegments() {
    console.log("🧪 Testing New Broadcast Segments...");

    // 1. Test Stalled Users
    console.log("\n📡 Segment: STALLED_USERS");
    const stalled = await getCleanBroadcastList({ audience: "stalled_users" });
    if (stalled.success && stalled.data) {
        console.log(`✅ Found: ${stalled.data.count} recipients`);
        console.log(`📝 Sample: ${stalled.data.recipients.slice(0, 2).map(r => r.email).join(", ")}`);
    } else {
        console.error("❌ Stalled segment failed:", stalled.error);
    }

    // 2. Test Ghost Users
    console.log("\n📡 Segment: GHOST_USERS");
    const ghosts = await getCleanBroadcastList({ audience: "ghost_users" });
    if (ghosts.success && ghosts.data) {
        console.log(`✅ Found: ${ghosts.data.count} recipients`);
        console.log(`📝 Sample: ${ghosts.data.recipients.slice(0, 2).map(r => r.email).join(", ")}`);
    } else {
        console.error("❌ Ghost segment failed:", ghosts.error);
    }

    // 3. Test Pending Users
    console.log("\n📡 Segment: PENDING_USERS");
    const pending = await getCleanBroadcastList({ audience: "pending_users" });
    if (pending.success && pending.data) {
        console.log(`✅ Found: ${pending.data.count} recipients`);
        console.log(`📝 Sample: ${pending.data.recipients.slice(0, 2).map(r => r.email).join(", ")}`);
    } else {
        console.error("❌ Pending segment failed:", pending.error);
    }

    // 4. Test Active Users
    console.log("\n📡 Segment: ACTIVE_USERS");
    const active = await getCleanBroadcastList({ audience: "active_users" });
    if (active.success && active.data) {
        console.log(`✅ Found: ${active.data.count} recipients`);
        console.log(`📝 Sample: ${active.data.recipients.slice(0, 2).map(r => r.email).join(", ")}`);
    } else {
        console.error("❌ Active segment failed:", active.error);
    }
}

// Mocking required session/admin logic for test script
process.env.ADMIN_OVERRIDE = "true"; 

testNewSegments().catch(console.error);
