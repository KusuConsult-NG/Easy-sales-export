
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { getCleanBroadcastListAction } from "../src/app/actions/broadcast";

async function testNewSegments() {
    console.log("🧪 Testing New Broadcast Segments...");

    // 1. Test Stalled Users
    console.log("\n📡 Segment: STALLED_USERS");
    const stalled = await getCleanBroadcastListAction({ audience: "stalled_users" });
    if (stalled.success && stalled.data) {
        console.log(`✅ Found: ${stalled.data.count} recipients`);
        console.log(`📝 Sample: ${stalled.data.recipients.slice(0, 2).map(r => r.email).join(", ")}`);
    } else {
        console.error("❌ Stalled segment failed:", stalled.error);
    }

    // 2. Test Ghost Users
    console.log("\n📡 Segment: GHOST_USERS");
    const ghosts = await getCleanBroadcastListAction({ audience: "ghost_users" });
    if (ghosts.success && ghosts.data) {
        console.log(`✅ Found: ${ghosts.data.count} recipients`);
        console.log(`📝 Sample: ${ghosts.data.recipients.slice(0, 2).map(r => r.email).join(", ")}`);
    } else {
        console.error("❌ Ghost segment failed:", ghosts.error);
    }
}

// Mocking required session/admin logic for test script
process.env.ADMIN_OVERRIDE = "true"; 

testNewSegments().catch(console.error);
