import { getCached, setCache, deleteCache, CacheKeys, CACHE_TTL } from './redis';
import { runQueryWithRetry } from './firestore-utils';
import { getAdminDb } from './firebase-admin';
import { COLLECTIONS } from "@/lib/types/firestore";
import { resolveActiveUser } from "./user-identity";

export interface CachedUserProfile {
    id: string;
    email: string;
    displayName: string;
    photoURL?: string;
    roles: string[];
    serviceRegistrations?: any;
    createdAt: string;
    updatedAt: string;
    profileComplete?: boolean;
    onboardingCompleted?: boolean;
    requiresPasswordChange?: boolean;
    /**
     * The revocation point: sessions authenticated before this are no longer
     * this account's.
     *
     *   #343 THIS FIELD WAS READ AND NEVER CARRIED.
     *
     *        #306 made changePasswordAction and the password reset stamp
     *        `sessionsValidFrom` on the user document, and the jwt callback in
     *        lib/auth.ts decides revocation from it:
     *
     *            const revokedBefore = Number((cachedProfile as any).sessionsValidFrom) || 0;
     *            token.sessionRevoked = revokedBefore > 0 && issuedAtMs > 0
     *                                   && issuedAtMs < revokedBefore;
     *
     *        `cachedProfile` is what getUserProfile below returns, and that
     *        function builds its result from a CLOSED FIELD LIST which did not
     *        include this one. So `revokedBefore` was Number(undefined) || 0 =
     *        0, the predicate short-circuited on `revokedBefore > 0`, and
     *        `token.sessionRevoked` was false for every session that has ever
     *        existed. Changing your password never signed the intruder out —
     *        the whole point of #306.
     *
     *        The `as any` cast is what let it compile past review. It is gone.
     *
     *        The suite did not catch it because it mocked the join:
     *
     *            getUserProfile.mockImplementation(async () =>
     *                ({ sessionsValidFrom: RESET_AT, roles: [] }));
     *
     *        — a shape no writer produces. The write side was tested, the read
     *        side was tested against a fabricated profile, and the projection
     *        between them was tested by nothing.
     */
    sessionsValidFrom?: number;
    isBanned?: boolean;
    suspended?: boolean;
    status?: string;
    sellerVerificationStatus?: string;
    verified?: boolean;
    isVerified?: boolean;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    otherName?: string;
    phone?: string;
    location?: string;
    bio?: string;
    identityDocument?: any;
    gender?: string;
}

/**
 * Get user profile from cache or Firestore
 */
export async function getUserProfile(userId: string): Promise<CachedUserProfile | null> {
    try {
        // Try cache first
        const cacheKey = CacheKeys.userProfile(userId);
        const cached = await getCached<CachedUserProfile>(cacheKey);

        if (cached) {
            return cached;
        }

        // Cache miss — fetch from Supabase
        const { supabaseAdmin } = await import("./supabase");
        const { data: dbRow, error } = await supabaseAdmin
            .from("users")
            .select("*")
            .eq("id", userId)
            .single();

        let userData: any = null;

        if (error || !dbRow) {
            // Fallback: Try Firestore as a safe guard if not found in Supabase
            try {
                const db = getAdminDb();
                const userDoc = await runQueryWithRetry<any>(() => db.collection(COLLECTIONS.USERS).doc(userId).get());
                if (!userDoc.exists) {
                    return null;
                }
                userData = userDoc.data()!;
            } catch (fsErr) {
                console.error('[getUserProfile] Firestore fallback failed:', fsErr);
                return null;
            }
        } else {
            userData = dbRow.raw_data || {};
        }

        /**
         *   #449 THIS RECURSED WITH NO CYCLE GUARD AND NO LIMIT, AND A BROKEN
         *        POINTER RESOLVED TO NOTHING.
         *
         *        `return getUserProfile(migratedId)` — so two rows pointing at
         *        each other spun forever. Not a stack overflow: every hop
         *        awaits, so it yields and simply never returns. The probe that
         *        found it had to be killed rather than failing. In production
         *        that is a login request that never answers.
         *
         *        And a pointer naming a row that is not there returned null,
         *        which lib/auth.ts turns into "User profile not found in
         *        database". The user's profile is the one they started from;
         *        they were told they do not exist because a POINTER broke.
         *
         *        The walk is bounded and shared now — see lib/user-identity.ts.
         *        It keeps the last row that EXISTED, so a broken chain degrades
         *        to the newest good profile instead of to no profile.
         */
        const resolved = await resolveActiveUser(userId, async (id) => {
            if (id === userId) return userData;
            const doc = await runQueryWithRetry<any>(
                () => getAdminDb().collection(COLLECTIONS.USERS).doc(id).get());
            return doc.exists ? doc.data() : null;
        });

        if (resolved.healed) {
            console.warn(
                `[getUserProfile] migration chain from ${userId} stopped at ${resolved.id} ` +
                `after ${resolved.hops} hop(s): ${resolved.stoppedBecause}. ` +
                `Serving the last profile that exists.`,
            );
        }

        if (resolved.id !== userId) {
            console.log(`[getUserProfile] legacy user ${userId} resolves to ${resolved.id}.`);
        }
        userData = resolved.row ?? userData;
        const activeId = resolved.id;

        // NOTE: registerAction writes 'fullName' to Firestore, not 'displayName'.
        // We read both to handle legacy documents that may have used 'displayName'.
        const resolvedName = userData.fullName || userData.displayName || '';
        const profile: CachedUserProfile = {
            id: activeId,
            email: dbRow?.email || userData.email,
            displayName: resolvedName,
            photoURL: userData.photoURL,
            roles: dbRow?.roles || userData.roles || [],
            serviceRegistrations: userData.serviceRegistrations,
            createdAt: dbRow?.created_at || userData.createdAt,
            updatedAt: dbRow?.updated_at || userData.updatedAt,
            profileComplete: userData.profileComplete,
            onboardingCompleted: userData.onboardingCompleted,
            requiresPasswordChange: userData.requiresPasswordChange,
            // #343. Read by the jwt callback and, until now, never carried here.
            sessionsValidFrom: Number(userData.sessionsValidFrom) || undefined,
            isBanned: userData.isBanned,
            suspended: userData.suspended,
            status: userData.status,
            sellerVerificationStatus: userData.sellerVerificationStatus,
            verified: userData.verified,
            isVerified: userData.isVerified,
            fullName: userData.fullName || resolvedName,
            firstName: userData.firstName,
            lastName: userData.lastName,
            otherName: userData.otherName,
            phone: userData.phone,
            location: userData.location,
            bio: userData.bio,
            identityDocument: userData.identityDocument,
            gender: userData.gender,
        };

        // Cache for next time
        await setCache(cacheKey, profile, CACHE_TTL.USER_PROFILE);

        return profile;
    } catch (error) {
        console.error('[getUserProfile] Error:', error);
        return null;
    }
}

/**
 * Invalidate user cache (call this when user data changes)
 */
export async function invalidateUserCache(userId: string): Promise<void> {
    try {
        await Promise.all([
            deleteCache(CacheKeys.userProfile(userId)),
            deleteCache(CacheKeys.userPermissions(userId)),
            deleteCache(CacheKeys.userSession(userId)),
            deleteCache(CacheKeys.userStats(userId)),
        ]);
    } catch (error) {
        console.error('[invalidateUserCache] Error:', error);
    }
}

/**
 * Check if user has specific role (with caching)
 */
export async function userHasRole(userId: string, role: string): Promise<boolean> {
    const profile = await getUserProfile(userId);
    return profile?.roles?.includes(role) ?? false;
}

/**
 * Check if user service is approved (with caching)
 */
export async function isServiceApproved(
    userId: string,
    service: 'wave' | 'export' | 'marketplace' | 'academy' | 'cooperatives' | 'farmNation'
): Promise<boolean> {
    const profile = await getUserProfile(userId);
    return profile?.serviceRegistrations?.[service]?.status === 'approved';
}
