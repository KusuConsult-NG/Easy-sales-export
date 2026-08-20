/**
 * schema-normalizer.ts
 *
 * DISEASE 2 FIX — Inconsistent Firestore field names (split schema).
 *
 * The same concept is stored under multiple field names depending on which
 * code path wrote it:
 *   - cooperative key: "cooperative" AND "cooperatives" (both exist in DB)
 *   - farm nation key: "farmNation" AND "farm_nation" (both exist in DB)
 *   - phone: "phone" AND "phoneNumber"
 *   - name: "name", "fullName", "displayName"
 *
 * This normalizer is called at WRITE TIME on every user document update.
 * It ensures that whenever one key is written, the canonical alias is also
 * written — so reads that look up either key always find the same value.
 *
 * Usage (in any server action that updates a user doc):
 *   import { normalizeUserDoc } from "@/lib/schema-normalizer";
 *   const safeUpdate = normalizeUserDoc(updatePayload);
 *   await userRef.set(safeUpdate, { merge: true });
 *   // OR: await userRef.update(safeUpdate);
 *
 * Rules enforced:
 *   1. serviceRegistrations.cooperative ↔ serviceRegistrations.cooperatives (mirror both)
 *   2. serviceRegistrations.farmNation ↔ serviceRegistrations.farm_nation (mirror both)
 *   3. phone → phoneNumber (canonical: phone)
 *   4. name / fullName / displayName (canonical: name, also write fullName)
 */

import { registrationProgressScore, isDecidedAgainst } from "@/lib/registration-progress";

type AnyObject = Record<string, any>;

/**
 * Normalizes a flat dot-notation update object (as used with Firestore .update())
 * to ensure canonical field aliases are always written together.
 *
 * Example:
 *   Input:  { "serviceRegistrations.cooperatives.status": "approved" }
 *   Output: { "serviceRegistrations.cooperatives.status": "approved",
 *             "serviceRegistrations.cooperative.status": "approved" }
 */
export function normalizeUserUpdate(update: AnyObject): AnyObject {
    const result: AnyObject = { ...update };

    /**
     * Rules 1 and 2: cooperative ↔ cooperatives, farmNation ↔ farm_nation.
     * Each matched as a sub-path AND as the whole object.
     *
     * The four blocks this replaces tested `startsWith("...cooperatives.")`
     * — with a trailing dot — so a write of the WHOLE registration under one
     * spelling, `{"serviceRegistrations.cooperatives": {...}}`, matched nothing
     * and left the other spelling stale. Every caller today writes a sub-path,
     * so this had no live victim; a normaliser whose entire job is "both keys
     * always agree" should not have a shape it silently ignores.
     */
    const ALIAS_PAIRS: ReadonlyArray<readonly [string, string]> = [
        ["serviceRegistrations.cooperatives", "serviceRegistrations.cooperative"],
        ["serviceRegistrations.farmNation", "serviceRegistrations.farm_nation"],
    ];

    for (const [key, value] of Object.entries(update)) {
        for (const pair of ALIAS_PAIRS) {
            for (const [from, to] of [pair, [pair[1], pair[0]] as const]) {
                if (key !== from && !key.startsWith(`${from}.`)) continue;
                const mirrorKey = to + key.slice(from.length);
                if (!(mirrorKey in result)) result[mirrorKey] = value;
            }
        }

        // ── Rule 3: phone ↔ phoneNumber ───────────────────────────────────
        if (key === "phone" && !("phoneNumber" in result)) result["phoneNumber"] = value;
        if (key === "phoneNumber" && !("phone" in result)) result["phone"] = value;

        // ── Rule 4: name / fullName / displayName ─────────────────────────
        if (key === "name" && !("fullName" in result)) result["fullName"] = value;
        if (key === "fullName" && !("name" in result)) result["name"] = value;
        if (key === "displayName") {
            // fullName too. normalizeUserDoc, the nested twin of this function,
            // writes BOTH from displayName; this one wrote only `name`. Two
            // normalisers whose whole purpose is that the aliases agree,
            // disagreeing with each other about one of the aliases.
            if (!("name" in result)) result["name"] = value;
            if (!("fullName" in result)) result["fullName"] = value;
        }
    }

    return result;
}

/**
 * Normalizes a NESTED object (as used with Firestore .set(data, { merge: true }))
 * to ensure both canonical key variants are always written.
 *
 * Example:
 *   Input:  { serviceRegistrations: { cooperatives: { status: "approved" } } }
 *   Output: { serviceRegistrations: {
 *               cooperatives: { status: "approved" },
 *               cooperative: { status: "approved" }   ← added
 *             } }
 */
export function normalizeUserDoc(doc: AnyObject): AnyObject {
    const result: AnyObject = deepClone(doc);

    // Initialize serviceRegistrations if not present
    if (!result.serviceRegistrations || typeof result.serviceRegistrations !== "object") {
        result.serviceRegistrations = {};
    }
    const sr = result.serviceRegistrations;
    const roles: string[] = Array.isArray(result.roles) ? result.roles : [];

    /**
     * Sync roles to service registration statuses (self-healing for legacy users).
     *
     * THIS USED TO REVERSE A REJECTION, ON LOGIN, AND PERSIST IT.
     * ----------------------------------------------------------
     * The rule was "if the role is present and the status is not approved, make
     * it approved":
     *
     *     if (roles.includes("wave_participant")) {
     *         if (sr.wave.status !== "approved") sr.wave.status = "approved";
     *     }
     *
     * and normalizeUserDoc is called by session-guard on every uncached session
     * resolution and by auth.ts on every login, both of which WRITE THE RESULT
     * BACK with `set(normalized, { merge: true })`.
     *
     * The WAVE rejection (wave/_wv_admin_applications.ts) and both Academy
     * rejections (admin/_academy.ts, academy/_ac_admin_review.ts) write
     * `status: "rejected"` and do NOT strip the corresponding role. So an admin
     * rejected an application, the applicant logged in, and the rejection was
     * silently replaced with "approved" in the database. Farm Nation strips
     * `farmer` on rejection but never `land_owner`, and this fires on either.
     * The cooperative was safe only by accident — its suspend path revokes the
     * role, which was fixed for a different reason.
     *
     * This is #180 inverted. There a repair tool downgraded live registrations;
     * here a repair rule upgraded refused ones. Same lesson: a derived signal
     * may fill in what is MISSING and must never overwrite what somebody
     * decided.
     *
     * So: still heals a legacy account that has the role and no status — which
     * is what the note above always meant — and still promotes a status that is
     * merely less far along. It will not touch a decision.
     */
    const healFromRole = (keys: string[], granted: string) => {
        /**
         * A decision under EITHER spelling blocks the heal for BOTH.
         *
         * The two keys are one registration written two ways. Skipping only the
         * spelling that carries the rejection heals its ABSENT twin to
         * "approved" — and then the alias mirroring below, which keeps whichever
         * side is further along, copies that straight back over the rejection.
         * The first version of this fix did exactly that and a test caught it:
         * the guard has to see the pair, not each key on its own.
         */
        if (keys.some((k) => isDecidedAgainst(sr[k]?.status))) return;

        for (const key of keys) {
            const existing = (sr[key] && typeof sr[key] === "object") ? sr[key] : {};
            const current = existing.status;

            if (registrationProgressScore(current) >= registrationProgressScore(granted)) {
                sr[key] = existing;
                continue;
            }

            sr[key] = { ...existing, status: granted };
        }
    };

    if (roles.includes("wave_participant")) {
        healFromRole(["wave"], "approved");
    }
    if (roles.includes("cooperative_member")) {
        healFromRole(["cooperatives", "cooperative"], "approved");
    }
    if (roles.includes("academy_participant")) {
        healFromRole(["academy"], "approved");
    }
    if (roles.includes("farmer") || roles.includes("land_owner")) {
        healFromRole(["farmNation", "farm_nation"], "approved");
    }

    // ── Normalize serviceRegistrations nested object ───────────────────────
    if (result.serviceRegistrations && typeof result.serviceRegistrations === "object") {
        const sr = result.serviceRegistrations;

        // Rule 1: cooperative ↔ cooperatives
        if (sr.cooperatives && !sr.cooperative) {
            sr.cooperative = deepClone(sr.cooperatives);
        } else if (sr.cooperative && !sr.cooperatives) {
            sr.cooperatives = deepClone(sr.cooperative);
        } else if (sr.cooperative && sr.cooperatives) {
            const scorePlural = registrationProgressScore(sr.cooperatives.status || '');
            const scoreSingular = registrationProgressScore(sr.cooperative.status || '');
            
            const mergedCoop = scoreSingular > scorePlural
                ? { ...sr.cooperatives, ...sr.cooperative }
                : { ...sr.cooperative, ...sr.cooperatives };

            sr.cooperative = mergedCoop;
            sr.cooperatives = mergedCoop;
        }

        // Rule 2: farmNation ↔ farm_nation
        if (sr.farmNation && !sr.farm_nation) {
            sr.farm_nation = deepClone(sr.farmNation);
        } else if (sr.farm_nation && !sr.farmNation) {
            sr.farmNation = deepClone(sr.farm_nation);
        } else if (sr.farmNation && sr.farm_nation) {
            const scorePlural = registrationProgressScore(sr.farmNation.status || '');
            const scoreSingular = registrationProgressScore(sr.farm_nation.status || '');
            
            const mergedFn = scoreSingular > scorePlural
                ? { ...sr.farmNation, ...sr.farm_nation }
                : { ...sr.farm_nation, ...sr.farmNation };

            sr.farmNation = mergedFn;
            sr.farm_nation = mergedFn;
        }

        result.serviceRegistrations = sr;
    }

    // ── Normalize phone ────────────────────────────────────────────────────
    if (result.phone !== undefined && result.phoneNumber === undefined) {
        result.phoneNumber = result.phone;
    } else if (result.phoneNumber !== undefined && result.phone === undefined) {
        result.phone = result.phoneNumber;
    }

    // ── Normalize name / fullName ──────────────────────────────────────────
    if (result.name !== undefined && result.fullName === undefined) {
        result.fullName = result.name;
    } else if (result.fullName !== undefined && result.name === undefined) {
        result.name = result.fullName;
    }
    if (result.displayName !== undefined && result.name === undefined) {
        result.name = result.displayName;
        result.fullName = result.displayName;
    }

    return result;
}

function isPlainObject(val: any): boolean {
    if (val === null || typeof val !== 'object') return false;
    const proto = Object.getPrototypeOf(val);
    return proto === null || proto === Object.prototype;
}

function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (obj instanceof Date) {
        return new Date(obj.getTime()) as any;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item)) as any;
    }

    // Preserve non-plain objects like FieldValue, Timestamp, etc.
    if (!isPlainObject(obj)) {
        return obj;
    }

    const clonedObj: any = Object.create(Object.getPrototypeOf(obj));
    for (const key of Object.keys(obj)) {
        clonedObj[key] = deepClone((obj as any)[key]);
    }
    return clonedObj;
}
