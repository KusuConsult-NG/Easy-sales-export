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

    // ── Rule 1: cooperative ↔ cooperatives ────────────────────────────────
    // If any dot-notation key starts with "serviceRegistrations.cooperatives."
    // also write the same key with "serviceRegistrations.cooperative." and vice versa.
    for (const [key, value] of Object.entries(update)) {
        if (key.startsWith("serviceRegistrations.cooperatives.")) {
            const mirrorKey = key.replace("serviceRegistrations.cooperatives.", "serviceRegistrations.cooperative.");
            if (!(mirrorKey in result)) result[mirrorKey] = value;
        }
        if (key.startsWith("serviceRegistrations.cooperative.")) {
            const mirrorKey = key.replace("serviceRegistrations.cooperative.", "serviceRegistrations.cooperatives.");
            if (!(mirrorKey in result)) result[mirrorKey] = value;
        }

        // ── Rule 2: farmNation ↔ farm_nation ──────────────────────────────
        if (key.startsWith("serviceRegistrations.farmNation.")) {
            const mirrorKey = key.replace("serviceRegistrations.farmNation.", "serviceRegistrations.farm_nation.");
            if (!(mirrorKey in result)) result[mirrorKey] = value;
        }
        if (key.startsWith("serviceRegistrations.farm_nation.")) {
            const mirrorKey = key.replace("serviceRegistrations.farm_nation.", "serviceRegistrations.farmNation.");
            if (!(mirrorKey in result)) result[mirrorKey] = value;
        }

        // ── Rule 3: phone ↔ phoneNumber ───────────────────────────────────
        if (key === "phone" && !("phoneNumber" in result)) result["phoneNumber"] = value;
        if (key === "phoneNumber" && !("phone" in result)) result["phone"] = value;

        // ── Rule 4: name / fullName / displayName ─────────────────────────
        if (key === "name" && !("fullName" in result)) result["fullName"] = value;
        if (key === "fullName" && !("name" in result)) result["name"] = value;
        if (key === "displayName" && !("name" in result)) result["name"] = value;
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

    // ── Normalize serviceRegistrations nested object ───────────────────────
    if (result.serviceRegistrations && typeof result.serviceRegistrations === "object") {
        const sr = result.serviceRegistrations;

        // Rule 1: cooperative ↔ cooperatives
        if (sr.cooperatives && !sr.cooperative) {
            sr.cooperative = deepClone(sr.cooperatives);
        } else if (sr.cooperative && !sr.cooperatives) {
            sr.cooperatives = deepClone(sr.cooperative);
        } else if (sr.cooperative && sr.cooperatives) {
            const getProgressScore = (status: string) => {
                switch (status) {
                    case 'active':
                    case 'approved':
                        return 4;
                    case 'pending':
                    case 'pending_review':
                    case 'revision_required':
                        return 3;
                    case 'pending_repair':
                    case 'legacy_pending_onboarding':
                        return 2;
                    case 'not_started':
                        return 1;
                    default:
                        return 0;
                }
            };
            const scorePlural = getProgressScore(sr.cooperatives.status || '');
            const scoreSingular = getProgressScore(sr.cooperative.status || '');
            
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
            const getProgressScore = (status: string) => {
                switch (status) {
                    case 'active':
                    case 'approved':
                    case 'verified':
                        return 4;
                    case 'pending':
                    case 'pending_review':
                    case 'revision_required':
                        return 3;
                    case 'pending_repair':
                    case 'legacy_pending_onboarding':
                        return 2;
                    case 'not_started':
                        return 1;
                    default:
                        return 0;
                }
            };
            const scorePlural = getProgressScore(sr.farmNation.status || '');
            const scoreSingular = getProgressScore(sr.farm_nation.status || '');
            
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
