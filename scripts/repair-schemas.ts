/**
 * Fill in the three user fields the application assumes are always present.
 *
 *     npx tsx scripts/repair-schemas.ts            # report only
 *     npx tsx scripts/repair-schemas.ts --apply
 *
 * IT REPAIRED THE FIRST 5,000 USERS AND CALLED THAT COMPLETE — #329.
 *
 * The read was `db.collection(COLLECTIONS.USERS).get()` with no .limit(), which
 * stops at the adapter's 5,000-row default (supabase-db.ts DEFAULT_QUERY_LIMIT)
 * and hands back the truncated page as though it were the collection. The
 * script then chunked those rows carefully into batches of 500 and printed
 *
 *     --- Schema Repair Complete ---
 *     Repaired Documents: N
 *
 * The careful chunking is what makes it convincing: everything below the read
 * is correct, and all of it operates on 12% of a ~41,000-user table. .all() is
 * the adapter's own answer, added for exactly this — "repair every user"
 * silently becoming "repair the first 5,000 and report success".
 *
 * AND A FAILED RUN EXITED 0. It ended `repairSchemas().catch(console.error)`,
 * so a thrown error was logged and the process exited successfully. Any
 * wrapper — a shell `&&`, a CI step, an operator reading `$?` — saw a clean
 * run. It goes through runScript now.
 *
 * WHAT IT WRITES, AND ONE FIELD NOTHING READS
 * -------------------------------------------
 * `roles` and `serviceRegistrations` are read all over the application, and a
 * user missing either genuinely breaks screens.
 *
 * `_schemaVersion` is not: the string does not appear anywhere in src/ outside
 * this file. It is written and never read. It is KEPT rather than dropped —
 * removing a field from rows that already carry it is a destructive change to
 * make on a guess, and the value is harmless — but it is recorded here so that
 * nobody later mistakes it for a migration marker something depends on.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { isApply, targetHost, modeBanner, runScript } from "./_maintenance-guard";

const CHUNK = 500;

export async function repairSchemas() {
    const apply = isApply();
    console.log(modeBanner("🔧 User schema repair", apply, targetHost()));

    // .all(), not a bare .get() — see the note above.
    const usersSnapshot = await db.collection(COLLECTIONS.USERS).all().get();
    console.log(`${usersSnapshot.size} users read.`);

    const repairs: { id: string; updates: Record<string, unknown> }[] = [];

    for (const doc of usersSnapshot.docs) {
        const data = doc.data() as any;
        const updates: Record<string, unknown> = {};

        // See the header: written, read by nothing. Kept deliberately.
        if (!data._schemaVersion) updates._schemaVersion = 2;

        if (!data.roles || !Array.isArray(data.roles)) updates.roles = ["general_user"];

        if (!data.serviceRegistrations || typeof data.serviceRegistrations !== "object") {
            updates.serviceRegistrations = {};
        }

        if (Object.keys(updates).length > 0) repairs.push({ id: doc.id, updates });
    }

    console.log(`${repairs.length} users need at least one field filled in.`);

    const byField: Record<string, number> = {};
    for (const { updates } of repairs) {
        for (const k of Object.keys(updates)) byField[k] = (byField[k] ?? 0) + 1;
    }
    for (const [field, count] of Object.entries(byField)) {
        console.log(`   ${field}: ${count}`);
    }

    if (!apply) {
        console.log("\nNothing written. Re-run with --apply once the counts above look right.");
        return repairs.length;
    }

    for (let i = 0; i < repairs.length; i += CHUNK) {
        const chunk = repairs.slice(i, i + CHUNK);
        const batch = db.batch();
        for (const { id, updates } of chunk) {
            batch.set(
                db.collection(COLLECTIONS.USERS).doc(id),
                { ...updates, updatedAt: FieldValue.serverTimestamp() },
                { merge: true },
            );
        }
        await batch.commit();
        console.log(`   committed ${chunk.length} (${Math.min(i + CHUNK, repairs.length)}/${repairs.length})`);
    }

    return repairs.length;
}

if (require.main === module) {
    runScript("User schema repair", repairSchemas);
}
