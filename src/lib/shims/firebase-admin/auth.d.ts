/**
 * The authentication surface this shim actually implements.
 *
 * This file previously read, in its entirety:
 *
 *     export function getAuth(app?: any): any;
 *     export type Auth = any;
 *
 * `Auth = any` meant every call into the authentication layer was unchecked.
 * A call to a method the shim does not have, or a read of a field the shim
 * does not return, compiled cleanly and failed at runtime. That is how
 * `auth.getUsers(...)` — called at four places in broadcast-logic.ts against a
 * method that has never existed — reached production, and how
 * `userRecord.metadata.creationTime` in orphaned-user-repair.ts:100 got past
 * review while `metadata` was not part of the returned record.
 *
 * DECLARE ONLY WHAT auth.js IMPLEMENTS. The point of this file is that the
 * compiler refuses a call the shim cannot serve. Adding a declaration for a
 * Firebase method that is not implemented below re-creates the exact bug this
 * replaces — implement it in auth.js first.
 *
 * Deliberately NOT declared, because they are not implemented: verifyIdToken,
 * setCustomUserClaims, generatePasswordResetLink, generateEmailVerificationLink,
 * revokeRefreshTokens, createSessionCookie, verifySessionCookie,
 * getUserByProviderUid, importUsers. If one is needed, write it in auth.js and
 * declare it here — do not reach for `as any` at the call site.
 */

/** The subset of Firebase's UserRecord that auth.js returns. */
export interface ShimUserRecord {
    uid: string;
    email?: string;
    emailVerified: boolean;
    displayName?: string;
    phoneNumber?: string;
    disabled: boolean;
    /** Always present. Its absence used to be a TypeError in the repair scan. */
    metadata: {
        creationTime?: string;
        lastSignInTime?: string;
    };
    customClaims: Record<string, any>;
}

/** What getUsers() accepts. Only `uid` is used by this codebase today. */
export type UserIdentifier =
    | { uid: string }
    | { email: string }
    | { phoneNumber: string };

export interface CreateUserParams {
    email?: string;
    password?: string;
    displayName?: string;
    /** Defaults to true, matching the previous hardcoded behaviour. */
    emailVerified?: boolean;
    /**
     * `uid` IS DELIBERATELY ABSENT.
     *
     * Supabase assigns the account id; its admin API has no way to accept one.
     * src/app/actions/auth.ts passed `uid: canonicalUid` with the comment
     * "Attempt to align Firebase UID with Supabase UUID", and it was silently
     * dropped every time. Declaring it here would restore that silence.
     */
}

export interface UpdateUserParams {
    email?: string;
    password?: string;
    displayName?: string;
    /** Suspends or restores the account. Was accepted and ignored. */
    disabled?: boolean;
}

export interface ListUsersResult {
    users: ShimUserRecord[];
    /**
     * The next page, or undefined at the end. Opaque to callers — it happens
     * to be a page number. It was hardcoded to undefined, which ended every
     * caller's paging loop after the first page.
     */
    pageToken?: string;
}

export interface GetUsersResult {
    users: ShimUserRecord[];
    /**
     * Identifiers with no matching account. Firebase reports misses here
     * rather than throwing, and the broadcast callers depend on that: one
     * member without an auth record must not fail a batch of 100.
     */
    notFound: UserIdentifier[];
}

export interface DeleteUsersResult {
    failureCount: number;
    successCount: number;
    /** Firebase's shape — auth-purge-orphans.ts reads `err.error.message`. */
    errors: Array<{ index: number; error: Error }>;
}

export interface Auth {
    createUser(params: CreateUserParams): Promise<ShimUserRecord>;
    updateUser(uid: string, params: UpdateUserParams): Promise<ShimUserRecord>;
    deleteUser(uid: string): Promise<Record<string, never>>;
    deleteUsers(uids: string[]): Promise<DeleteUsersResult>;

    /** Throws with code "auth/user-not-found" when there is no match. */
    getUserByEmail(email: string): Promise<ShimUserRecord>;
    /** Throws with code "auth/user-not-found" when there is no match. */
    getUserByPhoneNumber(phone: string): Promise<ShimUserRecord>;
    /** Throws with code "auth/user-not-found" when there is no match. */
    getUser(uid: string): Promise<ShimUserRecord>;

    /** Does NOT throw for a missing account — see GetUsersResult.notFound. */
    getUsers(identifiers: UserIdentifier[]): Promise<GetUsersResult>;

    listUsers(maxResults?: number, pageToken?: string): Promise<ListUsersResult>;

    createCustomToken(uid: string, claims?: Record<string, any>): Promise<string>;
}

export function getAuth(app?: any): Auth;
