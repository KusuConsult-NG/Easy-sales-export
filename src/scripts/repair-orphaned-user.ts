/**
 * Create the missing user row for an account that exists in auth but has no
 * profile.
 *
 *     npx tsx src/scripts/repair-orphaned-user.ts <uid> <email> "<full name>" [--apply]
 *
 * IT HELD A REAL PRODUCTION UID BESIDE PLACEHOLDER IDENTITY — #329.
 *
 * The whole of its input was four hard-coded constants:
 *
 *     const uid = 'Rc0mYvgCBCcgCQf0FzfMRC73Mvz1';
 *     const email = 'user@example.com'; // REPLACE WITH ACTUAL EMAIL FROM AUTH
 *     const fullName = 'User Name';     // REPLACE WITH ACTUAL NAME FROM AUTH
 *     const gender = 'male';            // REPLACE WITH ACTUAL GENDER
 *
 * written with `set(..., { merge: true })`. The uid is a real account. The other
 * three are placeholders, and nothing enforced the comments telling an operator
 * to replace them. Running the file as committed would overwrite that person's
 * email with "user@example.com" and their name with "User Name" — and because
 * update() and a merging set() do not distinguish "this field was not supplied"
 * from "this field is now this", the real values would simply be gone.
 *
 * It also wrote `verified: true` unconditionally, with the comment
 * "Auto-verify for all modules (not just WAVE)". This script has no way to
 * verify anybody; it was granting a status the platform's verification paths
 * exist to decide. Verification is now left absent — the account is repaired
 * so the person can sign in, and whatever verifies them does the verifying.
 *
 * The values come from the command line, placeholders are refused by name, and
 * nothing is written without --apply.
 */

import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS, type UserRole } from "@/lib/types/firestore";
import { isApply, targetHost, modeBanner, runScript } from "../../scripts/_maintenance-guard";

/**
 * The exact strings the committed version would have written. Refused by name
 * so that "I meant to edit those" cannot end in a real profile being
 * overwritten with them.
 */
export const PLACEHOLDERS = ["user@example.com", "User Name", "REPLACE"] as const;

export interface OrphanRepairInput {
    uid: string;
    email: string;
    fullName: string;
    roles?: UserRole[];
}

/** Throws unless every field is present and none of them is a placeholder. */
export function validateOrphanRepairInput(input: Partial<OrphanRepairInput>): OrphanRepairInput {
    const { uid, email, fullName } = input;

    if (!uid || !email || !fullName) {
        throw new Error(
            "uid, email and full name are all required.\n" +
            '  npx tsx src/scripts/repair-orphaned-user.ts <uid> <email> "<full name>" --apply',
        );
    }

    for (const value of [uid, email, fullName]) {
        for (const placeholder of PLACEHOLDERS) {
            if (value.includes(placeholder)) {
                throw new Error(
                    `Refusing to write the placeholder "${placeholder}". ` +
                    `Take the real values from the auth record for ${uid}.`,
                );
            }
        }
    }

    if (!email.includes("@")) throw new Error(`"${email}" is not an email address.`);

    return { uid, email, fullName, roles: input.roles ?? ["general_user"] };
}

export async function repairOrphanedUser(input: Partial<OrphanRepairInput>) {
    const apply = isApply();
    console.log(modeBanner("🩹 Orphaned user repair", apply, targetHost()));

    const { uid, email, fullName, roles } = validateOrphanRepairInput(input);

    const existing = await db.collection(COLLECTIONS.USERS).doc(uid).get();
    if (existing.exists) {
        // Not an orphan. Merging over a live profile is how the placeholders
        // would have destroyed a real email and name.
        throw new Error(`${uid} already has a profile — this script is only for accounts that have none.`);
    }

    const profile = {
        uid,
        fullName,
        email,
        roles,
        // NOT `verified: true`. See the header — this script cannot verify
        // anyone, and the paths that can are the ones that should.
    };

    if (!apply) {
        console.log("WOULD CREATE:", JSON.stringify(profile, null, 2));
        return { created: false, profile };
    }

    await db.collection(COLLECTIONS.USERS).doc(uid).set({
        ...profile,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`✅ Created profile for ${uid}. They can now sign in.`);
    return { created: true, profile };
}

if (require.main === module) {
    const [uid, email, fullName] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    runScript("Orphaned user repair", () => repairOrphanedUser({ uid, email, fullName }));
}
