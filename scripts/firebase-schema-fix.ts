/**
 * Academy schema & data repair — CLI entrypoint.
 *
 * THIS SCRIPT CRASHED ON ITS NINTH LINE, AND ALWAYS HAD — #328.
 *
 * It opened with:
 *
 *     import * as admin from 'firebase-admin';
 *     ...
 *     if (!admin.apps.length) { ... admin.initializeApp({ credential: ... }) }
 *     const db = admin.firestore();
 *
 * `firebase-admin` here is not Google's SDK. package.json resolves it to
 * `file:./src/lib/shims/firebase-admin`, whose index.js is two lines:
 *
 *     module.exports = { auth: () => ({}) };
 *
 * So `admin.apps` is undefined, `admin.apps.length` throws "Cannot read
 * properties of undefined (reading 'length')", and everything below it — the
 * tier migration, the course seeding, and the closing "🎉 All fixes applied
 * successfully" — was unreachable from the day it was written.
 *
 * A one-second typecheck names every line of it. It had never been run:
 * tsconfig.json excluded `scripts` and eslint.config.mjs ignored `scripts/**`,
 * so this directory was the only place in the repository outside both gates,
 * while holding the files that write to the live database by hand. Both
 * exclusions are gone; see the notes left in their place.
 *
 * The repairs themselves now live in ./academy-schema-repair.ts, which has no
 * side effects on import and is executed by
 * src/__tests__/unit/maintenance-scripts-are-inside-the-gates.test.ts.
 *
 * The name is kept so an operator's existing notes still find it. It targets
 * Supabase, like everything else here.
 *
 *     npx tsx scripts/firebase-schema-fix.ts
 */

import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { migrateLegacyAcademyPlans, initializeAcademyCourses } from "./academy-schema-repair";

async function main() {
    console.log("🚀 Academy schema & data repair — target: Supabase\n");

    // NOT wrapped in per-step try/catch. Each half of the original caught its
    // own errors, logged them and returned normally, after which main() printed
    // "🎉 All fixes applied successfully." and exited 0 — so a run that
    // repaired nothing was indistinguishable from one that repaired
    // everything. A failed step fails the run now.
    console.log("🔍 Scanning for academy plans stored under a name we no longer sell...");
    const repaired = await migrateLegacyAcademyPlans((m) => console.log(m));
    for (const { id, from, to } of repaired) {
        console.log(`   ${id}: "${from}" → "${to}"`);
    }

    console.log("\n🔍 Checking default Academy Courses...");
    const created = await initializeAcademyCourses((m) => console.log(m));

    console.log("\n--- Complete ---");
    console.log(`Academy plans repaired: ${repaired.length}`);
    console.log(`Courses created:        ${created.length}${created.length ? ` (${created.join(", ")})` : ""}`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("❌ Academy repair FAILED:", err);
        process.exit(1);
    });
