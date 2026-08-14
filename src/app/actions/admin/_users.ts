"use server";

import { ZodError } from "zod";
import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import crypto from 'crypto';
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { runQueryWithRetry } from "@/lib/firestore-utils";
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeValue } from "@/lib/firestore-serialize";
import { UserVerificationToggleSchema, UserKycVerificationSchema } from "@/lib/schemas";
import { hasAdminPermission, isAdmin, isSuperAdmin, includesPrivilegedRole } from "@/lib/admin-permissions";
import { atomicUpdateUser } from "@/lib/services/userService";
import { writeGuard, UserRolesWriteSchema } from "@/lib/write-guard";
import { safeToISOString, safeToISOStringOptional } from "@/lib/date-utils";

// ============================================
// User Verification Toggle
// ============================================

async function _toggleUserVerificationAction(
    userId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const };
        }

        const valid = UserVerificationToggleSchema.safeParse({ userId });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        // Get current user doc
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { error: "User not found", success: false as const };
        }

        const currentData = userDoc.data()!;
        const newVerificationStatus = !currentData.isVerified;

        const { safeUpdate } = await import("@/lib/firestore-utils");
        await safeUpdate(COLLECTIONS.USERS, userId, {
            isVerified: newVerificationStatus,
            "kyc.status": newVerificationStatus ? "verified" : "pending",
            kycStatus: newVerificationStatus ? "verified" : "pending",
            verifiedBy: session.user.id,
            verifiedAt: newVerificationStatus ? FieldValue.serverTimestamp() : null,
        });

        // CLEAR CACHE - User verification status changed
        try {
            const { invalidateUserCache } = await import('@/lib/cache-invalidation');
            await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
            logger.info(`[User Verification] Cache cleared for user: ${userId} and global stats invalidated`);
        } catch (cacheError) {
            logger.error('[User Verification] Cache clear error:', cacheError);
        }

        // Log audit
        await createAdminAuditLog({
            action: newVerificationStatus ? "user_verify" : "user_unverify",
            userId: session.user.id,
            targetId: userId,
            targetType: "user",
        });

        return {
            error: null,
            success: true as const,
            message: `User ${newVerificationStatus ? "verified" : "unverified"} successfully`,
        };
    } catch (error: any) {
        logger.error("Toggle user verification error:", error);
        return { error: "Failed to update verification status", success: false as const };
    }
}

// ============================================
// User KYC Verification Toggle
// ============================================

async function _toggleUserKycVerificationAction(
    userId: string,
    field: 'bvn' | 'nin' | 'tin' | 'cac',
    currentStatus: boolean
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        // Assuming "users:update" is sufficient for KYC. Could create a stricter role if needed.
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const };
        }

        const valid = UserKycVerificationSchema.safeParse({ userId, field, currentStatus });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { error: "User not found", success: false as const };
        }

        const newVerificationStatus = !currentStatus;

        // Map to both nested kyc.* paths (new) and top-level fields (legacy compatibility)
        const nestedFieldMap: Record<string, string> = {
            bvn: 'kyc.bvnVerified',
            nin: 'kyc.ninVerified',
            tin: 'tinVerified',
            cac: 'cacVerified',
        };
        const legacyFieldMap: Record<string, string> = {
            bvn: 'bvnVerified',
            nin: 'ninVerified',
            tin: 'tinVerified',
            cac: 'cacVerified',
        };
        const nestedField = nestedFieldMap[field];
        const legacyField = legacyFieldMap[field];
        const statusField = field === 'bvn' ? 'kyc.bvnStatus' : field === 'nin' ? 'kyc.ninStatus' : null;

        const updatePayload: Record<string, any> = {
            [nestedField]: newVerificationStatus,
            [legacyField]: newVerificationStatus,
            updatedAt: FieldValue.serverTimestamp(),
        };
        if (statusField) {
            updatePayload[statusField] = newVerificationStatus ? 'verified' : 'unverified';
        }
        // Also update overall kyc.status when BVN or NIN changes
        if (field === 'bvn' || field === 'nin') {
            const snap = await userRef.get();
            const userData = snap.data();
            const otherField = field === 'bvn' ? 'nin' : 'bvn';
            const otherVerifiedField = field === 'bvn' ? 'ninVerified' : 'bvnVerified';
            
            const otherVal = userData?.kyc?.[otherField];
            const hasOther = otherVal && otherVal !== '' && otherVal !== crypto.createHash('sha256').update('00000000000').digest('hex');
            const otherVerified = !hasOther || (userData?.kyc?.[otherVerifiedField] ?? false);

            updatePayload['kyc.status'] = (newVerificationStatus && otherVerified) ? 'verified' : 'pending';
            updatePayload['kycVerified'] = newVerificationStatus && otherVerified;
        }

        await atomicUpdateUser(userId, updatePayload);

        // CLEAR CACHE
        try {
            const { invalidateUserCache } = await import('@/lib/cache-invalidation');
            await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
            logger.info(`[User KYC Verification] Cache cleared for user: ${userId} and global stats invalidated`);
        } catch (cacheError) {
            logger.error('[User KYC Verification] Cache clear error:', cacheError);
        }

        // Log audit
        await createAdminAuditLog({
            action: newVerificationStatus ? `user_kyc_verify_${field}` : `user_kyc_unverify_${field}`,
            userId: session.user.id,
            targetId: userId,
            targetType: "user",
        });

        return {
            error: null,
            success: true as const,
            message: `${field.toUpperCase()} ${newVerificationStatus ? "verified" : "unverified"} successfully`,
        };
    } catch (error: any) {
        logger.error(`Toggle user KYC verification error (${field}):`, error);
        return { error: `Failed to update ${field.toUpperCase()} verification status`, success: false as const };
    }
}

 // ============================================
 // Update User Gender (Admin Only)
 // ============================================
 async function _updateUserGenderAction(
     userId: string,
     gender: "male" | "female"
 ): Promise<ActionState> {
     try {
         const sessionResult = await requireSession();
         if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
         const { session } = sessionResult;
         if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
             return { error: "Unauthorized: Permission required - users:update", success: false as const };
         }
         await atomicUpdateUser(userId, {
             gender,
         });
         // Log audit
         await createAdminAuditLog({
             action: "user_gender_update",
             userId: session.user.id,
             targetId: userId,
             targetType: "user",
             metadata: { newGender: gender },
         });
         return {
             error: null,
             success: true as const,
             message: `User gender updated to ${gender} successfully`,
         };
     } catch (error: any) {
         logger.error("Update user gender error:", error);
         return { error: "Failed to update gender", success: false as const };
     }
 }

// ============================================
// Rate Limit Management (Admin)
// ============================================

/**
 * Unlock a rate-limited user account
 * Allows admins to manually reset login attempt counters
 */
async function _unlockUserAccount(email: string): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:read")) {
            return { error: "Unauthorized: Permission required - users:read", success: false as const };
        }

        if (!email || !email.includes("@")) {
            return { error: "Invalid email address", success: false as const };
        }

        // Reset rate limit
        const { resetLoginAttempts } = await import("@/lib/rate-limit");
        await resetLoginAttempts(email);

        // Log audit
        await createAdminAuditLog({
            action: "account_unlock",
            userId: session.user.id,
            targetId: email,
            targetType: "user",
            metadata: { email },
        });

        return {
            error: null,
            success: true as const,
            message: `Account unlocked: ${email}`,
        };
    } catch (error: any) {
        logger.error("Unlock account error:", error);
        return { error: "Failed to unlock account", success: false as const };
    }
}

// ============================================
// User Management (Admin)
// ============================================

// ============================================
// User Management (Admin)
// ============================================

interface GetUsersOptions {
    limit?: number;
    page?: number;      // 0-indexed page number for offset pagination
    role?: string;
    status?: "verified" | "unverified" | "all";
    search?: string;
    lastDocId?: string; // kept for backwards-compat but now treated as page number string
    state?: string;     // filter by address.state
    lga?: string;       // filter by address.lga
    fromDate?: string;  // ISO date string – createdAt >= fromDate
    toDate?: string;    // ISO date string – createdAt <= toDate
    sortOrder?: "asc" | "desc"; // Sort direction
    modules?: string;   // 'all' | 'multi' | specific module slug ('academy', 'marketplace', etc.)
    sortBy?: "createdAt" | "gender"; // Sort field
    gender?: "male" | "female" | "all"; // Filter by gender
}

async function _getUsersAction(options: GetUsersOptions = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:read")) {
            const roles = session?.user?.roles ?? [];
            logger.warn(`[getUsersAction] Permission denied. Session roles: ${roles.join(", ") || "none (session may be stale — user must re-login)"}`);
            return {
                error: `Unauthorized: your session does not have the 'users:read' permission. Current roles: [${roles.join(", ") || "none"}]. Please sign out and sign back in to refresh your session.`,
                success: false as const,
                data: null,
            };
        }

        const pageSize = options.search ? 5000 : (options.limit || 50);
        const page = options.page ?? 0; // page offset (0-indexed)

        let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.USERS);

        let hasUnindexedFilter = false;

        // Apply filters
        let matchingUserIds: string[] = [];
        if (options.search) {
            const { searchUserIdsByQuery } = await import("@/lib/admin-search-helper");
            matchingUserIds = await searchUserIdsByQuery(options.search);
            
            if (matchingUserIds.length === 0) {
                return {
                    error: null,
                    success: true as const,
                    data: [],
                    lastDocId: String(page + 1),
                    hasMore: false,
                    meta: {
                        totalCount: 0
                    }
                };
            }
            query = query.where(FieldPath.documentId(), "in", matchingUserIds);
            hasUnindexedFilter = true;
        }

        // Basic filtering (Role/Status/State/LGA) - Only apply if NOT doing a direct search
        if (!options.search) {
            if (options.role && options.role !== "all") {
                query = query.where("roles", "array-contains", options.role);
            }

            // IMPORTANT: Do NOT filter isVerified via Firestore query — 34k+ legacy users
            // have `verified: true` but NOT `isVerified`. A Firestore where("isVerified","==",true)
            // query would silently exclude them all.
            // Instead, status filtering is applied IN-MEMORY after the mapping step uses
            // the defensive chain: `data.isVerified ?? data.verified ?? false`

            // Location filters (No composite indexes exist for state/lga + createdAt desc)
            if ((options.state && options.state !== "all") || (options.lga && options.lga !== "all")) {
                hasUnindexedFilter = true;
            }
        }

        // Apply strict Date boundaries in Firestore
        // This ensures chronological fetching and accurate Date filtering without memory limits
        if (!hasUnindexedFilter) {
            if (options.fromDate) {
                // Ensure start of day boundary
                const startObj = new Date(options.fromDate);
                startObj.setUTCHours(0, 0, 0, 0);
                query = query.where("createdAt", ">=", startObj);
            }
            if (options.toDate) {
                // Ensure end of day boundary
                const endObj = new Date(options.toDate);
                endObj.setUTCHours(23, 59, 59, 999);
                query = query.where("createdAt", "<=", endObj);
            }
            
            // Order chronologically
            query = query.orderBy("createdAt", "desc");
        }

        // ---------------------------------------------------------
        // EXACT DATABASE COUNT (Satisfies Data Consistency Audit)
        // ---------------------------------------------------------
        let countQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.USERS);
        if (options.search) {
            countQuery = countQuery.where(FieldPath.documentId(), "in", matchingUserIds);
        } else {
            if (options.role && options.role !== "all") {
                countQuery = countQuery.where("roles", "array-contains", options.role);
            }
        }

        const countSnap = await runQueryWithRetry(() => countQuery.count().get());
        const absoluteDbCount = countSnap.data().count;

        // Fetch a dynamic batch — no orderBy (avoids missing-field exclusion).
        // We page in-memory after sort.
        // If searching or applying an unindexed filter, fetch a larger batch (5000) to ensure high search/filter coverage.
        // If doing standard navigation, scale limit based on the requested page to reduce expensive reads by 97%+
        const FETCH_LIMIT = (options.search || hasUnindexedFilter || options.fromDate || options.toDate || (options.role && options.role !== "all") || options.sortBy === "gender" || (options.gender && options.gender !== "all"))
            ? 2000
            : Math.min(2000, (page + 1) * pageSize + 100);
        query = query.limit(FETCH_LIMIT);

        const snapshot = await runQueryWithRetry(() => query.get());

        const users = snapshot.docs.map(doc => {
            const data = doc.data();
            // Defensive name derivation — supports all schema generations:
            // 1. New schema: firstName + lastName stored separately (onboarding post-April 2026)
            // 2. Legacy schema: fullName stored as single string
            // 3. Auth-only schema: name stored from Firebase Auth display name
            // IMPORTANT: Reject placeholder values like "User" or "Unknown" that were
            // written by the ghost-account auto-repair before April 2026. Fall through
            // to the email address so the admin table shows something meaningful.
            const PLACEHOLDER_NAMES = new Set(["user", "unknown", "unknown user", "n/a", ""]);
            const isPlaceholder = (v: any) => !v || PLACEHOLDER_NAMES.has(String(v).toLowerCase().trim());

            // Extract richest profile from serviceRegistrations if top-level fields are missing
            let bestFirstName = data.firstName;
            let bestLastName = data.lastName;
            let bestFullName = data.fullName;
            let bestPhone = data.phone;
            
            // Defensively extract state and lga (preventing React objects-as-children crashes)
            let bestState = data.address?.state || data.state;
            if (typeof bestState === 'object' && bestState !== null) {
                bestState = bestState.state || bestState.name || "";
            }
            if (typeof bestState !== 'string') bestState = "";

            let bestLga = data.address?.lga || data.lga;
            if (typeof bestLga === 'object' && bestLga !== null) {
                bestLga = bestLga.lga || bestLga.name || "";
            }
            if (typeof bestLga !== 'string') bestLga = "";

            // Aggressive KYC extraction from modules
            let bestBvn = data.kyc?.bvn || data.bvn;
            let bestBvnVerified = data.kyc?.bvnVerified ?? data.bvnVerified ?? false;
            let bestNin = data.kyc?.nin || data.nin;
            let bestNinVerified = data.kyc?.ninVerified ?? data.ninVerified ?? false;
            let bestBankDetails = data.bankDetails || {
                bankName: data.bankName || data.bankAccount?.bankName,
                accountNumber: data.accountNumber || data.bankAccountNumber || data.bankAccount?.accountNumber,
                accountName: data.accountName || data.bankAccountName || data.bankAccount?.accountName,
                bankCode: data.bankCode || data.bankAccount?.bankCode
            };

            // Defensive Next of Kin extraction
            const bestNextOfKin = data.nextOfKin || {
                name: data.nextOfKinName || "",
                phone: data.nextOfKinPhone || "",
                relationship: data.nextOfKinRelationship || "",
                address: data.nextOfKinAddress || ""
            };

            if (data.serviceRegistrations) {
                Object.values(data.serviceRegistrations).forEach((reg: any) => {
                    const profile = reg?.profile || reg;
                    if (!profile) return;
                    
                    if (isPlaceholder(bestFirstName) && profile.firstName && !isPlaceholder(profile.firstName)) bestFirstName = profile.firstName;
                    if (isPlaceholder(bestLastName) && profile.lastName && !isPlaceholder(profile.lastName)) bestLastName = profile.lastName;
                    if (isPlaceholder(bestFullName) && profile.fullName && !isPlaceholder(profile.fullName)) bestFullName = profile.fullName;
                    if (isPlaceholder(bestFullName) && profile.name && !isPlaceholder(profile.name)) bestFullName = profile.name;
                    
                    if (isPlaceholder(bestPhone) && profile.phone && !isPlaceholder(profile.phone)) bestPhone = profile.phone;
                    if (isPlaceholder(bestState) && profile.state && !isPlaceholder(profile.state)) bestState = profile.state;
                    if (isPlaceholder(bestLga) && profile.lga && !isPlaceholder(profile.lga)) bestLga = profile.lga;
                    
                    // Extract nextOfKin from module profile if missing
                    const nk = profile.nextOfKin || {};
                    if (!bestNextOfKin.name && (profile.nextOfKinName || nk.name)) {
                        bestNextOfKin.name = profile.nextOfKinName || nk.name;
                    }
                    if (!bestNextOfKin.phone && (profile.nextOfKinPhone || nk.phone)) {
                        bestNextOfKin.phone = profile.nextOfKinPhone || nk.phone;
                    }
                    if (!bestNextOfKin.relationship && (profile.nextOfKinRelationship || nk.relationship)) {
                        bestNextOfKin.relationship = profile.nextOfKinRelationship || nk.relationship;
                    }
                    if (!bestNextOfKin.address && (profile.nextOfKinAddress || nk.address)) {
                        bestNextOfKin.address = profile.nextOfKinAddress || nk.address;
                    }

                    // Extract KYC from module verificationProfile if available
                    const vp = profile.verificationProfile || reg.verificationProfile;
                    if (vp) {
                        if (!bestBvn && vp.bvn) bestBvn = vp.bvn;
                        if (!bestBvnVerified && vp.bvnVerified) bestBvnVerified = vp.bvnVerified;
                        if (!bestNin && vp.nin) bestNin = vp.nin;
                        if (!bestNinVerified && vp.ninVerified) bestNinVerified = vp.ninVerified;
                        
                        if (vp.bankDetails && !bestBankDetails?.accountNumber) {
                            bestBankDetails = vp.bankDetails;
                        }
                    }
                });
            }

            const derivedFirstName = !isPlaceholder(bestFirstName) ? bestFirstName : null;
            const derivedFullName  = !isPlaceholder(bestFullName)  ? bestFullName  : null;
            const derivedName = derivedFirstName
                ? [derivedFirstName, data.otherName, bestLastName].filter(Boolean).join(" ").trim()
                : (derivedFullName || data.displayName || (bestPhone && bestPhone !== "" ? bestPhone : data.email) || "Unknown");

            return {
                id: doc.id,
                name: derivedName,
                firstName: bestFirstName,
                lastName: bestLastName,
                otherName: data.otherName,
                email: data.email,
                phone: isPlaceholder(bestPhone) ? "" : bestPhone,
                role: data.roles?.[0] || "general_user",
                roles: data.roles || [],
                isVerified: data.isVerified ?? data.verified ?? false,
                createdAt: safeToISOString(data.createdAt, new Date(0).toISOString()),
                verifiedAt: safeToISOStringOptional(data.verifiedAt),
                // Location
                address: data.address,
                state: bestState || "",
                lga: bestLga || "",
                // KYC fields — prefer nested kyc.* (written by live QoreID actions),
                // fall back to legacy top-level fields for existing records
                bvn: bestBvn,
                bvnVerified: bestBvnVerified,
                bvnStatus: data.kyc?.bvnStatus || (bestBvnVerified ? 'verified' : undefined),
                nin: bestNin,
                ninVerified: bestNinVerified,
                ninStatus: data.kyc?.ninStatus || (bestNinVerified ? 'verified' : undefined),
                kycStatus: data.kyc?.status || data.kycStatus || 'pending',
                taxId: data.taxId,
                tinVerified: data.tinVerified,
                cacNumber: data.cacNumber,
                cacVerified: data.cacVerified,
                idType: data.kyc?.idType || data.idType,
                // Next of Kin
                nextOfKin: bestNextOfKin,
                // Other
                bankDetails: {
                    bankName: bestBankDetails?.bankName || "",
                    accountNumber: bestBankDetails?.accountNumber || "",
                    accountName: bestBankDetails?.accountName || bestFullName || (bestFirstName && bestLastName ? `${bestFirstName} ${bestLastName}` : ""),
                    bankCode: bestBankDetails?.bankCode || ""
                },
                metadata: data.metadata,
                accountType: data.marketplaceAccountType || data.serviceRegistrations?.marketplace?.accountType || data.accountType,
                // ── Module membership ────────────────────────────────────────────
                // Pass the full serviceRegistrations map so the admin UI can render
                // per-module status badges and detect multi-module enrolments.
                serviceRegistrations: data.serviceRegistrations || {},
                gender: data.gender || data.kyc?.gender || data.kyc?.kycData?.gender || Object.values(data.serviceRegistrations || {}).map((reg: any) => reg?.profile?.gender || reg?.gender).find(Boolean) || "",
                identityDocument: data.identityDocument || "",
            };
        });

        // ── Derive activeModules for each user (in-memory, zero extra Firestore reads) ──
        const MODULE_KEYS = ['marketplace', 'academy', 'wave', 'cooperatives', 'export', 'farmNation', 'farm_nation'];
        const ENROLLED_STATUSES = new Set(['pending', 'under_review', 'approved', 'active', 'paid', 'completed', 'suspended']);
        const usersWithModules = users.map(u => {
            const regs = u.serviceRegistrations as Record<string, any>;
            const active: string[] = [];
            for (const key of MODULE_KEYS) {
                const reg = regs[key];
                if (reg && ENROLLED_STATUSES.has(reg.status)) {
                    // Normalise to URL-friendly label
                    const label = key === 'farmNation' || key === 'farm_nation' ? 'farm-nation' : key;
                    if (!active.includes(label)) active.push(label);
                }
            }
            
            // Legacy marketplace fallback
            if (!active.includes('marketplace') && u.accountType) {
                active.push('marketplace');
            }
            
            return { ...u, activeModules: active, moduleCount: active.length };
        })

        // ── Email deduplication ───────────────────────────────────────────────
        // Ghost accounts auto-created by session-guard may share an email with
        // the user's REAL profile document (different Firestore doc ID).
        // Keep the "richest" document per email: prefer the one with the most
        // fields, breaking ties by earliest createdAt (the original account).
        const emailMap = new Map<string, typeof usersWithModules[0]>();
        const richness = (u: typeof usersWithModules[0]) => {
            // Score = number of meaningful non-placeholder fields present
            let score = 0;
            if (u.phone)    score += 10;
            if (u.firstName && u.firstName.toLowerCase() !== "user") score += 5;
            if (u.lastName)  score += 5;
            if (Object.keys(u.serviceRegistrations || {}).length > 0) score += 20;
            if (u.bvn)       score += 10;
            if (u.nin)       score += 10;
            return score;
        };
        for (const u of usersWithModules) {
            if (!u.email) continue;
            const key = u.email.toLowerCase().trim();
            const existing = emailMap.get(key);
            if (!existing) {
                emailMap.set(key, u);
            } else {
                const newScore = richness(u);
                const oldScore = richness(existing);
                if (newScore > oldScore) {
                    emailMap.set(key, u);
                } else if (newScore === oldScore) {
                    // Same richness — keep the older account (earlier createdAt)
                    const newTime = u.createdAt ? new Date(u.createdAt).getTime() : Infinity;
                    const oldTime = existing.createdAt ? new Date(existing.createdAt).getTime() : Infinity;
                    if (newTime < oldTime) emailMap.set(key, u);
                }
            }
        }
        const deduplicatedUsers = Array.from(emailMap.values());

        // Client-side search + date range filtering
        let filteredUsers = deduplicatedUsers;

        // In-memory Location filtering (State and LGA) — resolves the bug where direct Firestore
        // where("address.state") equality checks silently excluded users with state stored in other properties
        if (options.state && options.state !== "all" && typeof options.state === 'string') {
            const cleanStateFilter = options.state.toLowerCase().replace(/\s*state$/i, "").trim();
            filteredUsers = filteredUsers.filter(u => {
                const cleanUserState = typeof u.state === 'string' 
                    ? u.state.toLowerCase().replace(/\s*state$/i, "").trim() 
                    : "";
                return cleanUserState && cleanUserState.includes(cleanStateFilter);
            });
        }
        if (options.lga && options.lga !== "all" && typeof options.lga === 'string') {
            const cleanLgaFilter = options.lga.toLowerCase().trim();
            filteredUsers = filteredUsers.filter(u => {
                const cleanUserLga = typeof u.lga === 'string' ? u.lga.toLowerCase().trim() : "";
                return cleanUserLga && cleanUserLga.includes(cleanLgaFilter);
            });
        }

        if (options.search) {
            const s = options.search.toLowerCase().trim();
            filteredUsers = filteredUsers.filter(user => {
                const searchString = [
                    user.name,
                    user.firstName,
                    user.lastName,
                    user.email,
                    user.phone,
                    user.state,
                    user.lga
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }
        // Module filter — supports a specific module slug (e.g. 'academy') or 'multi' (2+ modules)
        if (options.modules && options.modules !== "all") {
            if (options.modules === "multi") {
                filteredUsers = filteredUsers.filter(u => u.moduleCount >= 2);
            } else {
                filteredUsers = filteredUsers.filter(u => (u.activeModules as string[]).includes(options.modules as string));
            }
        }

        // In-memory Gender filter — allows filtering to show only male/female users
        if (options.gender && options.gender !== "all") {
            const genderFilter = options.gender.toLowerCase();
            filteredUsers = filteredUsers.filter(u => {
                const g = String(u.gender || "").toLowerCase().trim();
                return g === genderFilter;
            });
        }

        // In-memory status filter — using the defensive chain already computed in mapping:
        if (options.status === "verified") {
            filteredUsers = filteredUsers.filter(u => u.isVerified === true);
        } else if (options.status === "unverified") {
            filteredUsers = filteredUsers.filter(u => !u.isVerified);
        }

        // ALWAYS apply date filters in memory as a definitive backstop.
        // This resolves the bug where Firestore cross-type ordering (Strings > Timestamps)
        // caused legacy string-based createdAt dates to leak past the `query.where(">=", Timestamp)` boundary.
        if (options.fromDate) {
            const from = new Date(options.fromDate);
            from.setUTCHours(0, 0, 0, 0);
            filteredUsers = filteredUsers.filter(u => new Date(u.createdAt) >= from);
        }
        if (options.toDate) {
            const to = new Date(options.toDate);
            to.setUTCHours(23, 59, 59, 999);
            filteredUsers = filteredUsers.filter(u => new Date(u.createdAt) <= to);
        }

        // Sort in-memory
        if (options.sortBy === "gender") {
            filteredUsers.sort((a, b) => {
                const aGender = String(a.gender || "").toLowerCase().trim();
                const bGender = String(b.gender || "").toLowerCase().trim();
                if (aGender === bGender) {
                    // secondary sort by createdAt desc
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime;
                }
                return options.sortOrder === "asc"
                    ? aGender.localeCompare(bGender)
                    : bGender.localeCompare(aGender);
            });
        } else {
            filteredUsers.sort((a, b) => {
                const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return options.sortOrder === "asc" ? aTime - bTime : bTime - aTime;
            });
        }

        // Page-offset slice: each page returns exactly pageSize items
        const offset = page * pageSize;
        const pagedUsers = filteredUsers.slice(offset, offset + pageSize);
        
        // Strip Firestore class instances (e.g. Timestamps in serviceRegistrations, address, metadata) using the shared
        // serializeValue() utility which recursively converts Timestamps to ISO strings — safer than JSON round-trip.
        const serializedUsers = serializeValue(pagedUsers);

        return {
            error: null,
            success: true as const,
            data: serializedUsers,
            lastDocId: String(page + 1),
            hasMore: offset + pageSize < filteredUsers.length,
            meta: {
                totalCount: (options.state && options.state !== "all") || (options.lga && options.lga !== "all")
                    ? filteredUsers.length
                    : absoluteDbCount
            }
        };
    } catch (error: any) {
        logger.error("Get users error:", error);
        const message = error?.message || String(error);
        const isTransient = message.includes("Premature close") || 
                            message.includes("socket hang up") || 
                            message.includes("ECONNRESET") ||
                            message.includes("Client network socket disconnected") ||
                            message.includes("FetchError") ||
                            message.includes("fetch failed") ||
                            message.includes("Connection closed") ||
                            message.includes("Socket closed") ||
                            message.includes("UNAVAILABLE") ||
                            message.includes("stream terminated") ||
                            message.includes("ERR_STREAM_PREMATURE_CLOSE");
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : message;
        return { error: "Failed to fetch users: " + userFriendlyMessage, success: false as const, data: null };
    }
}

// Update User Roles Action
async function _updateUserRolesAction(
    userId: string,
    roles: string[]
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:assign_roles")) {
            return { error: "Unauthorized: Permission required - users:assign_roles", success: false as const };
        }

        // Validate inputs
        const { UpdateUserRolesSchema } = await import("@/lib/schemas");
        const valid = UpdateUserRolesSchema.safeParse({ userId, roles });

        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        // Prevent admin from removing their own admin role
        if (userId === session.user.id && !isAdmin(roles)) {
            return { error: "Cannot remove your own admin privileges", success: false as const };
        }

        // Only a super_admin may hand out admin authority.
        //
        // This writes the roles array wholesale, and UserRoleSchema accepts
        // "admin" and "super_admin" as values, so the check above was the only
        // thing standing between an admin and calling this on their own id with
        // ["super_admin"] — which it does not catch, because adding a role is
        // not removing one.
        //
        // The rule is deliberately blunt: any request whose resulting roles
        // include admin or super_admin needs a super_admin to make it. That also
        // stops a plain admin editing an existing admin's unrelated roles, since
        // the array has to carry "admin" through to preserve it. Editing another
        // admin's account is the case worth being strict about.
        if (includesPrivilegedRole(roles) && !isSuperAdmin(session.user.roles)) {
            return { error: "Only a super admin can grant admin roles", success: false as const };
        }

        await atomicUpdateUser(userId, writeGuard(
            UserRolesWriteSchema,
            {
                roles: roles,
            },
            'admin/updateUserRoles'
        ));

        await createAdminAuditLog({
            action: "user_role_change",
            userId: session.user.id,
            targetId: userId,
            targetType: "user",
            metadata: {
                roles,
                serviceRegistrationsUpdated: false,
            },
        });

        // DISEASE 1 FIX: Invalidate the user's Redis cache immediately after a role change.
        // The JWT callback reads from getUserProfile() which hits the cache. Without this,
        // the user's new roles won't appear in their session until the cache TTL expires
        // (up to 1 hour), meaning they get bounced to onboarding even after being approved.
        try {
            const { invalidateUserCache } = await import('@/lib/cache-invalidation');
            await invalidateUserCache(userId);
        } catch (e) {
            // Non-fatal: cache invalidation failure doesn't undo the role write
            logger.warn("[updateUserRolesAction] Cache invalidation failed (non-fatal):", e as Error);
        }

        return { success: true as const, error: null, message: "User roles updated" };
    } catch (error: any) {
        return { success: false as const, error: error.message };
    }
}

export const toggleUserVerificationAction = withFlexibleSafeAction("toggleUserVerificationAction", _toggleUserVerificationAction);

export const toggleUserKycVerificationAction = withFlexibleSafeAction("toggleUserKycVerificationAction", _toggleUserKycVerificationAction);

export const unlockUserAccount = withFlexibleSafeAction("unlockUserAccount", _unlockUserAccount);

export const getUsersAction = withFlexibleSafeAction("getUsersAction", _getUsersAction);

export const updateUserRolesAction = withFlexibleSafeAction("updateUserRolesAction", _updateUserRolesAction);

export const updateUserGenderAction = withFlexibleSafeAction("updateUserGenderAction", _updateUserGenderAction);
