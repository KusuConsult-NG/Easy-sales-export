
/**
 * CANONICAL DATA SCHEMAS
 *
 *   #355 THIS FILE IS THE READ HALF OF A MODEL WHOSE WRITE HALF IS DEAD, AND
 *        LATEST_SCHEMA_VERSION HAS NEVER BEEN STORED ON A SINGLE DOCUMENT.
 *
 *        Its header said "This file defines the platform-wide SINGLE SOURCE OF
 *        TRUTH (SSOT). All modules must normalize their data to these
 *        structures."
 *
 *        A CORRECTION TO MY OWN FIRST WRITE-UP, WHICH SAID THIS FILE WAS DEAD.
 *        It is not. lib/canonical/normalizer.ts imports it and normalizer has
 *        eight live importers across the admin, cooperative and WAVE actions.
 *        My reachability measurement had two faults that both pointed the same
 *        way — it looked one hop only, and it matched imports by BASENAME, so
 *        `import { loginSchema } from "./schemas"` in lib/auth.ts (which
 *        resolves to lib/schemas.ts, a different file entirely) was read as an
 *        importer of this one. The test file's helper now resolves every
 *        specifier against the importing file's own directory and walks the
 *        graph transitively. Both faults are recorded there.
 *
 *        WHAT IS ACTUALLY WRONG, having measured it properly:
 *
 *        (a) ONE module normalises to these shapes, not all of them, and it
 *            only ever builds a VIEW. normalizeAggressive returns a
 *            CanonicalUserProfile that admin/_marketplace.ts reads fields off
 *            and discards; nothing writes that object back. The live writers of
 *            the canonical block — kyc.ts, admin/_marketplace.ts and
 *            marketplace/_mp_onboarding.ts — assemble `verificationProfile` by
 *            hand and are not typed against this file at all.
 *
 *        (b) schemaVersion IS DECLARED TWICE HERE AND PERSISTED NOWHERE.
 *            LATEST_SCHEMA_VERSION reaches a stored document through exactly
 *            one code path — sync-engine.ts — and that module has zero callers
 *            (see its own header). normalizer sets it on the view object in
 *            (a), which is never saved. So no row in the database carries
 *            `schemaVersion`, and nothing reads it. Meanwhile
 *            scripts/repair-schemas.ts writes `_schemaVersion = 2` — a
 *            different field name and a different number. A migration keyed on
 *            either would find no rows to migrate.
 *
 *        KEPT, not deleted. The intent — one normalised identity shape — is
 *        the right one and is exactly what #25's verificationStatus split
 *        needs. Adopting it is a project, not a repair.
 *
 *        OWNER DECISION: adopt the canonical trio (schemas, sync-engine,
 *        verification-canonical) as a real migration, or retire the two dead
 *        halves and keep this file as the type definitions normalizer uses.
 */

export interface CanonicalIdentity {
    uid: string;
    email: string;
    fullName: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    gender?: "male" | "female";
    dateOfBirth?: string;
    roles: string[];
    isVerified: boolean;
    onboardingCompleted: boolean;
}

export interface CanonicalBankDetails {
    bankName: string;
    accountNumber: string;
    accountName: string;
    bankCode?: string;
}

export interface CanonicalAddress {
    street: string;
    city: string;
    state: string;
    lga: string;
    country: string;
}

export interface CanonicalVerificationProfile {
    status: "pending" | "approved" | "rejected" | "suspended" | "not_started";
    submittedAt?: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    rejectionReason?: string;
    documents: Record<string, { url: string; name: string }>;
    bankDetails?: CanonicalBankDetails;
    businessInfo?: {
        name: string;
        type: string;
        regNumber?: string;
    };
    isCanonical: boolean;
    schemaVersion: number;
}

export interface CanonicalServiceRegistrations {
    marketplace?: { status: string; approvedAt?: Date };
    cooperative?: { status: string; tier?: string; approvedAt?: Date };
    wave?: { status: string; approvedAt?: Date };
    academy?: { status: string; plan?: string; approvedAt?: Date };
    export?: { status: string; approvedAt?: Date };
    farmNation?: { status: string; approvedAt?: Date };
}

export interface CanonicalUserProfile extends CanonicalIdentity {
    address: CanonicalAddress;
    bankDetails: CanonicalBankDetails;
    nin?: string;
    bvn?: string;
    verificationProfile?: CanonicalVerificationProfile;
    serviceRegistrations: CanonicalServiceRegistrations;
    createdAt: Date;
    updatedAt: Date;
    schemaVersion: number;
}

export const LATEST_SCHEMA_VERSION = 8; // Incrementing for this major refactor
