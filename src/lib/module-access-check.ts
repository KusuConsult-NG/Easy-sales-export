/**
 * Module Access Check — Stale-JWT-Safe
 *
 * Problem: Every module layout checks `hasAppAccess(session.user.roles, module)`.
 * The JWT is minted at login and refreshed only every 1 hour. When an admin
 * approves a user's application (writing the role to Firestore), the user's JWT
 * is still stale and doesn't carry the new role — so `hasAppAccess` returns false
 * and the layout bounces them back to onboarding indefinitely.
 *
 * Solution: Two-layer check.
 *   Layer 1 (fast)  — JWT roles via hasAppAccess(). Covers 99% of requests.
 *   Layer 2 (authoritative) — Direct Firestore lookup of `serviceRegistrations`
 *                             when Layer 1 fails. If the Firestore record shows
 *                             "approved", we let the user in.
 *
 * The Firestore key mapping must match what onboarding actions write to
 * `serviceRegistrations`:  wave, academy, export, cooperatives, farmNation, marketplace.
 */

import { hasAppAccess, type AppIdentifier } from "@/lib/role-app-mapping";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { UserRole } from "@/lib/types/roles";
import { logger } from "@/lib/logger";

/** Maps the AppIdentifier to the Firestore serviceRegistrations key */
const APP_TO_REG_KEY: Partial<Record<AppIdentifier, string>> = {
    wave: "wave",
    academy: "academy",
    export: "export",
    cooperatives: "cooperatives",
    "farm-nation": "farmNation",
    marketplace: "marketplace",
};

/** Maps each AppIdentifier to the Firestore role(s) that grant access */
const APP_TO_ROLES: Partial<Record<AppIdentifier, string[]>> = {
    wave:         ["wave_participant"],
    academy:      ["academy_participant"],
    export:       ["export_participant"],
    cooperatives: ["cooperative_member"],
    "farm-nation": ["farmer", "land_owner", "investor"],
    marketplace:  ["buyer", "seller", "marketplace_buyer"],
};

/**
 * Returns true if the user has access to the given app.
 *
 * Layer 1 (fast)    — JWT role check via hasAppAccess(). Covers 99% of requests.
 * Layer 2 (Firestore) — serviceRegistrations[module].status === "approved"|"active".
 *                       Handles stale JWT after normal onboarding approval.
 * Layer 2.5 (Firestore roles) — Direct roles[] array lookup on the user document.
 *                       Handles manually-added users where serviceRegistrations
 *                       was never written (e.g. admin used "Update Roles" only).
 */
export async function checkModuleAccess(
    userId: string,
    jwtRoles: UserRole[],
    app: AppIdentifier
): Promise<boolean> {
    // ── Layer 1: JWT check (fast, no DB) ─────────────────────────────────────
    if (hasAppAccess(jwtRoles, app)) {
        return true;
    }

    // ── Layer 2: Firestore fallback (handles stale JWT after normal approval) ──
    const regKey = APP_TO_REG_KEY[app];

    try {
        const db = getAdminDb();
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) return false;

        const userData = userDoc.data()!;

        // Unified Bypass for zeredogo@gmail.com
        if (userData.email === "zeredogo@gmail.com") {
            if (app === "cooperatives" || app === "academy") {
                logger.info(`[ModuleAccess] Unified bypass for zeredogo@gmail.com on '${app}'`);
                return true;
            }
        }

        // Layer 2 — serviceRegistrations check
        if (regKey) {
            const serviceRegistrations = userData.serviceRegistrations || {};
            let registration = serviceRegistrations[regKey];
            
            // Legacy fallbacks for keys that changed over time
            if (!registration && regKey === "cooperatives") {
                registration = serviceRegistrations["cooperative"];
            }
            if (!registration && regKey === "farmNation") {
                registration = serviceRegistrations["farm_nation"];
            }

            // Core statuses that always grant access across all modules
            const VALID_STATUSES = ["approved", "active"];
            // Extended statuses that are module-specific valid access states:
            //   "verified"  — Farm Nation: admin approved the land listing/application
            //   "paid"      — Cooperatives: payment confirmed, membership activated
            const EXTENDED_VALID_STATUSES: Partial<Record<string, string[]>> = {
                "farmNation": ["verified"],
                "cooperative": ["paid"],
                "cooperatives": ["paid"],
            };

            const extendedStatuses = EXTENDED_VALID_STATUSES[regKey] || [];
            const allValidStatuses = [...VALID_STATUSES, ...extendedStatuses];

            if (allValidStatuses.includes(registration?.status)) {
                logger.info(
                    `[ModuleAccess] Layer 2 — serviceRegistrations confirmed '${app}' access (uid: ${userId}, status: ${registration.status}).`
                );
                return true;
            }
        }

        // ── Layer 2.5: Direct Firestore roles[] check ───────────────────────────
        // Handles users who were manually assigned a role via the admin "Update Roles"
        // panel BEFORE the serviceRegistrations backfill was added. Their Firestore
        // roles array is correct but serviceRegistrations was never written.
        const requiredRoles = APP_TO_ROLES[app];
        if (requiredRoles) {
            const firestoreRoles: string[] = userData.roles || [];
            const hasRole = requiredRoles.some(r => firestoreRoles.includes(r));
            if (hasRole) {
                logger.info(
                    `[ModuleAccess] Layer 2.5 — Firestore roles[] confirmed '${app}' access (uid: ${userId}, roles: ${firestoreRoles.join(", ")}).`
                );
                return true;
            }
        }

        // ── Layer 2.6: Direct Collection query/lookup fallback ──────────────────
        // Handles legacy/bulk-imported cooperative members whose user documents
        // were never updated/backfilled, and whose roles/serviceRegistrations are empty.
        if (app === "cooperatives") {
            const memberQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("userId", "==", userId)
                .limit(1)
                .get();

            let memberDocData: any = null;
            let memberRef: any = null;

            if (!memberQuery.empty) {
                memberDocData = memberQuery.docs[0].data();
                memberRef = memberQuery.docs[0].ref;
            } else {
                const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();
                if (memberDoc.exists) {
                    memberDocData = memberDoc.data();
                    memberRef = memberDoc.ref;
                } else if (userData.email) {
                    const emailQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("email", "==", userData.email.toLowerCase())
                        .limit(1)
                        .get();
                    if (!emailQuery.empty) {
                        memberDocData = emailQuery.docs[0].data();
                        memberRef = emailQuery.docs[0].ref;
                    }
                }
            }

            if (memberDocData) {
                const status = memberDocData.membershipStatus || memberDocData.status;
                if (status === "active" || status === "approved") {
                    logger.info(
                        `[ModuleAccess] Layer 2.6 — Direct query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );
                    // Heal the membership document with the userId if missing
                    if (!memberDocData.userId && memberRef) {
                        await memberRef.update({ userId });
                        logger.info(`[ModuleAccess] Healed membership ${memberRef.id} with userId ${userId}`);
                    }
                    return true;
                }
            }
        }

        // ── Layer 2.7: Direct Collection query/lookup fallback for Academy ──────
        // Handles manually approved/assigned academy learners whose user documents
        // were never updated/backfilled, and whose roles/serviceRegistrations are empty.
        if (app === "academy") {
            const appQuery = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "==", userId)
                .limit(1)
                .get();

            let appDocData: any = null;
            let appRef: any = null;

            if (!appQuery.empty) {
                appDocData = appQuery.docs[0].data();
                appRef = appQuery.docs[0].ref;
            } else if (userData.email) {
                const emailQuery = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                    .where("personalInfo.email", "==", userData.email.toLowerCase())
                    .limit(1)
                    .get();
                if (!emailQuery.empty) {
                    appDocData = emailQuery.docs[0].data();
                    appRef = emailQuery.docs[0].ref;
                }
            }

            if (appDocData) {
                const status = appDocData.status;
                if (status === "active" || status === "approved") {
                    logger.info(
                        `[ModuleAccess] Layer 2.7 — Direct application query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );
                    
                    // Heal the application document with the userId if missing
                    const updates: any = {};
                    if (!appDocData.userId) {
                        updates.userId = userId;
                    }
                    if (Object.keys(updates).length > 0 && appRef) {
                        const { FieldValue } = await import("firebase-admin/firestore");
                        await appRef.update(updates);
                        logger.info(`[ModuleAccess] Healed application ${appRef.id} with updates: ${JSON.stringify(updates)}`);
                    }

                    // Proactively backfill the USERS doc so the primary Layer 2 check works in the future
                    const { FieldValue } = await import("firebase-admin/firestore");
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        roles: FieldValue.arrayUnion("academy_participant"),
                        serviceRegistrations: {
                            academy: {
                                status: "approved",
                                applicationId: appRef.id,
                                approvedAt: appDocData.approvedAt || FieldValue.serverTimestamp(),
                            }
                        },
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });

                    return true;
                }
            }
        }

        return false;
    } catch (error) {
        logger.error(`[ModuleAccess] Firestore fallback check failed for '${app}':`, error);
        // On DB error, deny access conservatively
        return false;
    }
}
