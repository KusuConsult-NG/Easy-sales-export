/**
 * debug-coop-admin-scope.ts
 *
 * Diagnoses why the cooperative admin dashboard shows no members.
 * Checks: admin user doc, adminScope, cooperativeId field on members.
 *
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/debug-coop-admin-scope.ts
 */

import { db } from "../src/lib/firebase-admin";

const COOP_ADMIN_EMAIL = "easysalescooperative@gmail.com";

async function main() {
    console.log("\n🔍 Cooperative Admin Scope Diagnosis\n");

    // 1. Find the cooperative admin user doc
    const userSnap = await db.collection("users")
        .where("email", "==", COOP_ADMIN_EMAIL)
        .limit(1)
        .get();

    if (userSnap.empty) {
        console.log(`❌ No user doc found for ${COOP_ADMIN_EMAIL}`);
        return;
    }

    const adminDoc = userSnap.docs[0];
    const adminData = adminDoc.data();
    console.log("✅ Admin user doc found:", adminDoc.id);
    console.log("   Email      :", adminData.email);
    console.log("   Roles      :", JSON.stringify(adminData.roles));
    console.log("   adminRole  :", adminData.adminRole);
    console.log("   cooperativeId:", adminData.cooperativeId ?? "(NOT SET)");
    console.log("   moduleId   :", adminData.moduleId ?? "(NOT SET)");
    console.log("   adminScope :", adminData.adminScope ?? "(NOT SET)");
    console.log();

    // 2. Simulate getAdminScope logic
    const roles: string[] = adminData.roles || [];
    let computedScope: string | null = null;
    if (roles.includes("cooperative_admin") && adminData.cooperativeId) {
        computedScope = adminData.cooperativeId;
    }
    console.log("📐 Computed adminScope (from cooperativeId):", computedScope ?? "(null — no scope filter)");
    console.log();

    // 3. Check cooperative_members collection
    const totalSnap = await db.collection("cooperative_members").count().get();
    console.log(`📊 Total docs in cooperative_members: ${totalSnap.data().count}`);

    // 4. Check how many have cooperativeId set
    const withCoopId = await db.collection("cooperative_members")
        .where("cooperativeId", "!=", "")
        .count().get();
    console.log(`   Docs WITH cooperativeId set    : ${withCoopId.data().count}`);

    // 5. Check active members
    const activeSnap = await db.collection("cooperative_members")
        .where("membershipStatus", "==", "active")
        .count().get();
    console.log(`   Docs with membershipStatus=active: ${activeSnap.data().count}`);
    console.log();

    // 6. Sample 3 member docs to see their cooperativeId field
    const sampleSnap = await db.collection("cooperative_members")
        .where("membershipStatus", "==", "active")
        .limit(5).get();

    console.log("🔬 Sample active member docs (cooperativeId field):");
    sampleSnap.docs.forEach((d, i) => {
        const data = d.data();
        console.log(`   [${i+1}] ${d.id}`);
        console.log(`       firstName    : ${data.firstName || data.name || "—"}`);
        console.log(`       cooperativeId: ${data.cooperativeId ?? "(NOT SET)"}`);
        console.log(`       membershipStatus: ${data.membershipStatus}`);
    });
    console.log();

    // 7. If admin has a scope, check how many members match it
    if (computedScope) {
        const scopedSnap = await db.collection("cooperative_members")
            .where("cooperativeId", "==", computedScope)
            .count().get();
        console.log(`🎯 Members matching adminScope (cooperativeId="${computedScope}"): ${scopedSnap.data().count}`);
    } else {
        console.log("ℹ️  Admin has NO cooperativeId — query runs WITHOUT scope filter (shows all members).");
    }

    // 8. Check the actual getAdminScope function logic — look at moduleAdmins collection
    const moduleAdminSnap = await db.collection("moduleAdmins")
        .where("email", "==", COOP_ADMIN_EMAIL)
        .limit(1).get();

    if (!moduleAdminSnap.empty) {
        const maData = moduleAdminSnap.docs[0].data();
        console.log("\n📋 moduleAdmins doc found:");
        console.log("   ", JSON.stringify(maData, null, 2));
    } else {
        console.log("\n⚠️  No moduleAdmins doc found for this email.");
    }

    // 9. Check admin_roles collection
    const adminRoleSnap = await db.collection("admin_roles")
        .where("email", "==", COOP_ADMIN_EMAIL)
        .limit(1).get();
    if (!adminRoleSnap.empty) {
        console.log("\n📋 admin_roles doc found:");
        console.log("   ", JSON.stringify(adminRoleSnap.docs[0].data(), null, 2));
    }

    console.log("\n── DIAGNOSIS COMPLETE ──\n");
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
