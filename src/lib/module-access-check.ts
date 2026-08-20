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
import { isPaymentBypassAccount } from "@/lib/payment-bypass";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { UserRole } from "@/lib/types/roles";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { registrationProgressScore, isDecidedAgainst } from "@/lib/registration-progress";
import { latestApplication, APPLICATION_SCAN_LIMIT } from "@/lib/latest-application";


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

        // Payment bypass — see src/lib/payment-bypass.ts for who and why.
        if (isPaymentBypassAccount(userData.email)) {
            if (app === "cooperatives" || app === "academy") {
                logger.info(`[ModuleAccess] payment bypass applied on '${app}'`);
                return true;
            }
        }

        // Layer 2 — serviceRegistrations check
        if (regKey) {
            const serviceRegistrations = userData.serviceRegistrations || {};
            let registration = serviceRegistrations[regKey];
            
            // Legacy fallbacks for keys that changed over time - use advanced progression resolution logic
            if (regKey === "cooperatives") {
                const coopReg = serviceRegistrations["cooperatives"];
                const legacyReg = serviceRegistrations["cooperative"];


                if (coopReg && legacyReg) {
                    const scorePlural = registrationProgressScore(coopReg.status || '');
                    const scoreSingular = registrationProgressScore(legacyReg.status || '');
                    registration = scoreSingular > scorePlural ? legacyReg : coopReg;
                } else {
                    registration = coopReg || legacyReg;
                }
            }

            if (regKey === "farmNation") {
                const fnReg = serviceRegistrations["farmNation"];
                const legacyFnReg = serviceRegistrations["farm_nation"];


                if (fnReg && legacyFnReg) {
                    const scorePlural = registrationProgressScore(fnReg.status || '');
                    const scoreSingular = registrationProgressScore(legacyFnReg.status || '');
                    registration = scoreSingular > scorePlural ? legacyFnReg : fnReg;
                } else {
                    registration = fnReg || legacyFnReg;
                }
            }

            // Core statuses that always grant access across all modules
            const VALID_STATUSES = ["approved", "active"];
            // Extended statuses that are module-specific valid access states:
            //   "verified"  — Farm Nation: admin approved the land listing/application
            //   "paid"      — Cooperatives: payment confirmed, membership activated
            const EXTENDED_VALID_STATUSES: Partial<Record<string, string[]>> = {
                "farmNation": ["verified"],
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
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            let memberDocData: any = null;
            let memberRef: any = null;

            if (!memberQuery.empty) {
                const latestMember = latestApplication(memberQuery.docs);
                memberDocData = latestMember?.data();
                memberRef = latestMember?.ref;
            } else {
                const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();
                if (memberDoc.exists) {
                    memberDocData = memberDoc.data();
                    memberRef = memberDoc.ref;
                } else if (userData.email) {
                    const emailQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("email", "==", userData.email.toLowerCase())
                        .limit(APPLICATION_SCAN_LIMIT)
                        .get();
                    if (!emailQuery.empty) {
                        const latestByEmail = latestApplication(emailQuery.docs);
                        memberDocData = latestByEmail?.data();
                        memberRef = latestByEmail?.ref;
                    }
                }
            }

            if (memberDocData) {
                const status = memberDocData.membershipStatus || memberDocData.status;
                const isApprovedOrActive = status === "active" || status === "approved";

                // A SUSPENSION WAS UNDONE BY THE NEXT PAGE LOAD.
                //
                // isHealable asked "did they pay and finish onboarding?" and
                // never "was a decision made against them?". A suspended member
                // satisfies it exactly: they paid to join and their onboarding
                // is complete, and `suspended` is not "active" or "approved" —
                // so the heal below fired, wrote `membershipStatus: "active"`
                // back onto the member document, wrote
                // `serviceRegistrations.cooperatives.status: "active"` and
                // `arrayUnion("cooperative_member")` onto the user document, and
                // returned true.
                //
                // _coop_admin_members.ts was taught to revoke the role on
                // suspension precisely so a suspended member loses the module.
                // This layer handed it back on the very next cooperative page
                // load, in the database — savings, loans, contributions and
                // withdrawals with it.
                //
                // registration-progress.ts states "the cooperative was safe only
                // because its suspend path revokes the role too". That was
                // wrong, and this is why: revoking a role means nothing while a
                // repair rule re-grants it without reading the decision. Fourth
                // instance of the same shape — #207 (login self-heal), #225
                // (course enrolment), #227 (the application picked here).
                const decidedAgainst = isDecidedAgainst(status);

                const isHealable = !isApprovedOrActive
                    && !decidedAgainst
                    && memberDocData.onboardingCompleted === true
                    && memberDocData.paymentStatus === "completed";

                if (decidedAgainst) {
                    logger.info(
                        `[ModuleAccess] Layer 2.6 — cooperative membership decided against `
                        + `(uid: ${userId}, status: ${status}). No access, and no heal.`
                    );
                    return false;
                }

                if (isApprovedOrActive || isHealable) {
                    logger.info(
                        `[ModuleAccess] Layer 2.6 — Direct query confirmed '${app}' access (uid: ${userId}, status: ${status}, isHealable: ${isHealable}).`
                    );
                    
                    if (isHealable && memberRef) {
                        try {
                            // Update membership status to active
                            await memberRef.update({
                                membershipStatus: "active",
                                updatedAt: FieldValue.serverTimestamp()
                            });
                            
                            // Update user status and roles
                            await db.collection(COLLECTIONS.USERS).doc(userId).update(
                                normalizeUserUpdate({
                                    "serviceRegistrations.cooperatives.status": "active",
                                    "serviceRegistrations.cooperatives.activatedAt": FieldValue.serverTimestamp(),
                                    roles: FieldValue.arrayUnion("cooperative_member"),
                                    isVerified: true,
                                    updatedAt: FieldValue.serverTimestamp()
                                })
                            );
                            logger.info(`[ModuleAccess] Healed membership status to 'active' for user ${userId}`);
                        } catch (healErr) {
                            logger.error(`[ModuleAccess] Failed to heal membership status for user ${userId}`, healErr);
                        }
                    } else if (!memberDocData.userId && memberRef) {
                        // Heal the membership document with the userId if missing
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
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            let appDocData: any = null;
            let appRef: any = null;

            if (!appQuery.empty) {
                const latestApp = latestApplication(appQuery.docs);
                appDocData = latestApp?.data();
                appRef = latestApp?.ref;
            } else if (userData.email) {
                const emailQuery = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                    .where("personalInfo.email", "==", userData.email.toLowerCase())
                    .limit(APPLICATION_SCAN_LIMIT)
                    .get();
                if (!emailQuery.empty) {
                    const latestAppByEmail = latestApplication(emailQuery.docs);
                    appDocData = latestAppByEmail?.data();
                    appRef = latestAppByEmail?.ref;
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
                        const { FieldValue } = await import("./firestore-compat");
                        await appRef.update(updates);
                        logger.info(`[ModuleAccess] Healed application ${appRef.id} with updates: ${JSON.stringify(updates)}`);
                    }

                    // Proactively backfill the USERS doc so the primary Layer 2 check works in the future
                    const { FieldValue } = await import("./firestore-compat");
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

        // ── Layer 2.8: Direct Collection query/lookup fallback for WAVE ─────────
        if (app === "wave") {
            const appQuery = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("userId", "==", userId)
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            let appDocData: any = null;
            let appRef: any = null;

            if (!appQuery.empty) {
                const latestApp = latestApplication(appQuery.docs);
                appDocData = latestApp?.data();
                appRef = latestApp?.ref;
            } else if (userData.email) {
                let emailQuery = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                    .where("userEmail", "==", userData.email.toLowerCase())
                    .limit(APPLICATION_SCAN_LIMIT)
                    .get();
                if (emailQuery.empty) {
                    emailQuery = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                        .where("email", "==", userData.email.toLowerCase())
                        .limit(APPLICATION_SCAN_LIMIT)
                        .get();
                }
                if (!emailQuery.empty) {
                    const latestAppByEmail = latestApplication(emailQuery.docs);
                    appDocData = latestAppByEmail?.data();
                    appRef = latestAppByEmail?.ref;
                }
            }

            if (appDocData) {
                const status = appDocData.status;
                if (status === "approved" || status === "active") {
                    logger.info(
                        `[ModuleAccess] Layer 2.8 — Direct WAVE application query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );
                    
                    // Heal the application document with the userId if missing
                    const updates: any = {};
                    if (!appDocData.userId) {
                        updates.userId = userId;
                    }
                    if (Object.keys(updates).length > 0 && appRef) {
                        await appRef.update(updates);
                        logger.info(`[ModuleAccess] Healed WAVE application ${appRef.id} with updates: ${JSON.stringify(updates)}`);
                    }

                    // Proactively backfill the USERS doc
                    const { FieldValue } = await import("./firestore-compat");
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        roles: FieldValue.arrayUnion("wave_participant"),
                        serviceRegistrations: {
                            wave: {
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

        // ── Layer 2.9: Direct Collection query/lookup fallback for Export ────────
        if (app === "export") {
            const appQuery = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                .where("userId", "==", userId)
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            let appDocData: any = null;
            let appRef: any = null;

            if (!appQuery.empty) {
                const latestApp = latestApplication(appQuery.docs);
                appDocData = latestApp?.data();
                appRef = latestApp?.ref;
            } else if (userData.email) {
                let emailQuery = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                    .where("userEmail", "==", userData.email.toLowerCase())
                    .limit(APPLICATION_SCAN_LIMIT)
                    .get();
                if (emailQuery.empty) {
                    emailQuery = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                        .where("profile.email", "==", userData.email.toLowerCase())
                        .limit(APPLICATION_SCAN_LIMIT)
                        .get();
                }
                if (!emailQuery.empty) {
                    const latestAppByEmail = latestApplication(emailQuery.docs);
                    appDocData = latestAppByEmail?.data();
                    appRef = latestAppByEmail?.ref;
                }
            }

            if (appDocData) {
                const status = appDocData.status;
                if (status === "approved" || status === "active" || status === "approved_admin") {
                    logger.info(
                        `[ModuleAccess] Layer 2.9 — Direct Export application query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );
                    
                    // Heal the application document with the userId if missing
                    const updates: any = {};
                    if (!appDocData.userId) {
                        updates.userId = userId;
                    }
                    if (Object.keys(updates).length > 0 && appRef) {
                        await appRef.update(updates);
                        logger.info(`[ModuleAccess] Healed Export application ${appRef.id} with updates: ${JSON.stringify(updates)}`);
                    }

                    // Proactively backfill the USERS doc
                    const { FieldValue } = await import("./firestore-compat");
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        roles: FieldValue.arrayUnion("export_participant"),
                        serviceRegistrations: {
                            export: {
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

        // ── Layer 2.10: Direct Collection query/lookup fallback for Farm Nation ──
        if (app === "farm-nation") {
            const appQuery = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .where("userId", "==", userId)
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            let appDocData: any = null;
            let appRef: any = null;

            if (!appQuery.empty) {
                const latestApp = latestApplication(appQuery.docs);
                appDocData = latestApp?.data();
                appRef = latestApp?.ref;
            } else if (userData.email) {
                let emailQuery = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                    .where("userEmail", "==", userData.email.toLowerCase())
                    .limit(APPLICATION_SCAN_LIMIT)
                    .get();
                if (emailQuery.empty) {
                    emailQuery = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                        .where("profile.email", "==", userData.email.toLowerCase())
                        .limit(APPLICATION_SCAN_LIMIT)
                        .get();
                }
                if (!emailQuery.empty) {
                    const latestAppByEmail = latestApplication(emailQuery.docs);
                    appDocData = latestAppByEmail?.data();
                    appRef = latestAppByEmail?.ref;
                }
            }

            if (appDocData) {
                const status = appDocData.status;
                if (status === "approved" || status === "active" || status === "approved_admin") {
                    logger.info(
                        `[ModuleAccess] Layer 2.10 — Direct Farm Nation application query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );
                    
                    // Heal the application document with the userId if missing
                    const updates: any = {};
                    if (!appDocData.userId) {
                        updates.userId = userId;
                    }
                    if (Object.keys(updates).length > 0 && appRef) {
                        await appRef.update(updates);
                        logger.info(`[ModuleAccess] Healed Farm Nation application ${appRef.id} with updates: ${JSON.stringify(updates)}`);
                    }

                    // Prepare user roles
                    const roles: string[] = [];
                    if (appDocData.role === "buyer" || appDocData.role === "both") {
                        roles.push("investor");
                    }
                    if (appDocData.role === "seller" || appDocData.role === "both") {
                        roles.push("farmer");
                    }

                    // Proactively backfill the USERS doc
                    const { FieldValue } = await import("./firestore-compat");
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        roles: FieldValue.arrayUnion(...roles),
                        serviceRegistrations: {
                            farmNation: {
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

        // ── Layer 2.11: Direct Collection query/lookup fallback for Marketplace Seller ─
        if (app === "marketplace") {
            const verQuery = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where("userId", "==", userId)
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            if (!verQuery.empty) {
                const latestVer = latestApplication<any>(verQuery.docs);
                const verDocData = latestVer?.data();
                const verRef = latestVer?.ref;
                const status = verDocData?.status;
                if (status === "approved") {
                    logger.info(
                        `[ModuleAccess] Layer 2.11 — Direct Seller Verification query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );

                    // Proactively backfill the USERS doc
                    const { FieldValue } = await import("./firestore-compat");
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        roles: FieldValue.arrayUnion("seller"),
                        serviceRegistrations: {
                            marketplace: {
                                status: "approved",
                                applicationId: verRef.id,
                                approvedAt: verDocData.approvedAt || FieldValue.serverTimestamp(),
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
