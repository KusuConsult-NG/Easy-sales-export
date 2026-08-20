"use server";

import { type ActionState } from "@/lib/safe-action";

import { withFlexibleSafeAction } from "@/lib/safe-action";
import { revalidatePath } from 'next/cache';
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { hasAdminPermission } from "@/lib/admin-permissions";

// ============================================
// Admin Edit Application with Audit Trail
// ============================================

export interface EditableApplicationFields {
    firstName?: string;
    lastName?: string;
    middleName?: string;   // legacy field — keep for backward compat
    otherName?: string;    // new standard field — replaces middleName
    surname?: string;
    otherNames?: string;
    fullName?: string;
    businessName?: string;
    phone?: string;
    email?: string;
    stateOfOrigin?: string;
    lga?: string;
    stateOfResidence?: string;
    lgaOfResidence?: string;
    residentialAddress?: string;
    occupation?: string;
    membershipTier?: string;
    "nextOfKin.name"?: string;
    "nextOfKin.phone"?: string;
    "nextOfKin.relationship"?: string;
    "nextOfKin.address"?: string;
    // Banking fields
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
    bankCode?: string;
    "bankDetails.bankName"?: string;
    "bankDetails.accountNumber"?: string;
    "bankDetails.accountName"?: string;
    "bankDetails.bankCode"?: string;
    "bankAccount.bankName"?: string;
    "bankAccount.accountNumber"?: string;
    "bankAccount.accountName"?: string;
    "bankAccount.bankCode"?: string;
    // KYC overrides
    bvn?: string;
    nin?: string;
    cacNumber?: string;
    // Land listing editable fields
    title?: string;
    "location.state"?: string;
    "location.lga"?: string;
}

const ALLOWED_EDIT_FIELDS: (keyof EditableApplicationFields)[] = [
    "firstName", "lastName",
    "middleName",   // legacy — kept for backward compat
    "otherName",    // new KYC standard field
    "surname", "otherNames", "fullName", "businessName",
    "phone", "email",
    "stateOfOrigin", "lga", "stateOfResidence", "lgaOfResidence", "residentialAddress", "occupation",
    "membershipTier", "nextOfKin.name", "nextOfKin.phone", "nextOfKin.relationship", "nextOfKin.address",
    // Banking fields
    "bankName", "accountNumber", "accountName", "bankCode",
    "bankDetails.bankName", "bankDetails.accountNumber", "bankDetails.accountName", "bankDetails.bankCode",
    "bankAccount.bankName", "bankAccount.accountNumber", "bankAccount.accountName", "bankAccount.bankCode",
    // KYC
    "bvn", "nin", "cacNumber",
    // Land listing fields
    "title", "location.state", "location.lga",
];

async function _editApplicationAction(params: {
    collection: string;
    docId: string;
    fields: Partial<EditableApplicationFields>;
    editNote?: string;
}): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user) {
            return { error: "Unauthorized: admin or users:update role required", success: false as const };
        }

        let roles = session.user.roles;
        const isAuthorizedSession = hasAdminPermission(roles, "users:update") || roles?.includes("super_admin") || roles?.includes("admin");
        
        if (!isAuthorizedSession) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            const isAuthorizedLive = hasAdminPermission(liveRoles, "users:update") || liveRoles?.includes("super_admin") || liveRoles?.includes("admin");
            if (!isAuthorizedLive) {
                return { error: "Unauthorized: admin or users:update role required", success: false as const };
            }
            roles = liveRoles;
        }

        const { collection: collectionName, docId, fields, editNote } = params;

        // Validate the collection is one we allow editing
        const ALLOWED_COLLECTIONS = [
            COLLECTIONS.COOPERATIVE_MEMBERS,
            COLLECTIONS.WAVE_APPLICATIONS,
            COLLECTIONS.SELLER_VERIFICATIONS,
            COLLECTIONS.EXPORT_APPLICATIONS,
            COLLECTIONS.ACADEMY_APPLICATIONS,
            COLLECTIONS.USERS,
            COLLECTIONS.LAND_LISTINGS,
        ];
        if (!ALLOWED_COLLECTIONS.includes(collectionName as any)) {
            return { error: `Collection '${collectionName}' is not editable via this action`, success: false as const };
        }

        // Sanitize fields: only allow whitelisted keys
        const sanitized: Record<string, any> = {};
        for (const key of Object.keys(fields) as (keyof EditableApplicationFields)[]) {
            if (ALLOWED_EDIT_FIELDS.includes(key) && fields[key] !== undefined) {
                sanitized[key] = (fields[key] as string).trim();
            }
        }

        if (Object.keys(sanitized).length === 0) {
            return { error: "No valid fields to update", success: false as const };
        }

        // Fetch current doc to capture "before" snapshot for audit
        const docRef = db.collection(collectionName).doc(docId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return { error: `Document ${docId} not found in ${collectionName}`, success: false as const };
        }

        const before: Record<string, any> = {};
        const docData = docSnap.data()!;
        for (const key of Object.keys(sanitized)) {
            // Handle dot-notation keys like "nextOfKin.name"
            if (key.includes(".")) {
                const [parent, child] = key.split(".");
                before[key] = docData[parent]?.[child] ?? null;
            } else {
                before[key] = docData[key] ?? null;
            }
        }

        // ── SYNC PROFILE CHANGES ACROSS ACTIVE ECOSYSTEM MODULES ──
        const userId = docData?.userId || (collectionName === COLLECTIONS.USERS ? docId : (docId.startsWith("legacy_") ? docId.replace("legacy_", "") : docId));

        if (userId) {
            const syncBatch = db.batch();

            // Resolve actual application document IDs from central user profile
            let waveAppId = `legacy_${userId}`;
            let sellerAppId = `legacy_${userId}`;
            let exportAppId = `legacy_${userId}`;
            let academyAppId = `legacy_${userId}`;
            let farmAppId = `legacy_${userId}`;
            let coopAppId = userId;

            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const userSnap = await userRef.get();
            if (userSnap.exists) {
                const userData = userSnap.data()!;
                const regs = userData.serviceRegistrations || {};
                if (regs.wave?.applicationId) waveAppId = regs.wave.applicationId;
                if (regs.marketplace?.verificationId) sellerAppId = regs.marketplace.verificationId;
                if (regs.export?.applicationId) exportAppId = regs.export.applicationId;
                if (regs.academy?.applicationId) academyAppId = regs.academy.applicationId;
                if (regs.farmNation?.applicationId) farmAppId = regs.farmNation.applicationId;
            }

            // Override with actual docId for the collection currently being edited
            if (collectionName === COLLECTIONS.COOPERATIVE_MEMBERS) coopAppId = docId;
            else if (collectionName === COLLECTIONS.WAVE_APPLICATIONS) waveAppId = docId;
            else if (collectionName === COLLECTIONS.SELLER_VERIFICATIONS) sellerAppId = docId;
            else if (collectionName === COLLECTIONS.EXPORT_APPLICATIONS) exportAppId = docId;
            else if (collectionName === COLLECTIONS.ACADEMY_APPLICATIONS) academyAppId = docId;
            else if (collectionName === COLLECTIONS.FARM_NATION_APPLICATIONS) farmAppId = docId;
            
            const userUpdate: Record<string, any> = {};
            const coopUpdate: Record<string, any> = {};
            const waveUpdate: Record<string, any> = {};
            const sellerUpdate: Record<string, any> = {};
            const exportUpdate: Record<string, any> = {};
            const academyUpdate: Record<string, any> = {};
            const farmUpdate: Record<string, any> = {};

            const has = (key: string) => sanitized[key] !== undefined;
            const val = (key: string) => sanitized[key];

            const newFirstName = has("firstName") ? val("firstName") : (docData?.firstName || "");
            const newLastName = has("lastName") ? val("lastName") : (docData?.lastName || "");
            const newOtherName = has("otherName") ? val("otherName") : (docData?.otherName || "");
            let computedFullName = "";
            if (has("firstName") || has("lastName") || has("otherName")) {
                computedFullName = [newFirstName, newOtherName, newLastName].filter(Boolean).join(" ").trim();
            }

            if (has("firstName")) {
                userUpdate.firstName = val("firstName");
                coopUpdate.firstName = val("firstName");
                waveUpdate.firstName = val("firstName");
                exportUpdate["profile.firstName"] = val("firstName");
                farmUpdate["profile.firstName"] = val("firstName");
            }
            if (has("lastName")) {
                userUpdate.lastName = val("lastName");
                coopUpdate.lastName = val("lastName");
                waveUpdate.surname = val("lastName");
                exportUpdate["profile.lastName"] = val("lastName");
                farmUpdate["profile.lastName"] = val("lastName");
            }
            if (has("otherName")) {
                userUpdate.otherName = val("otherName");
                coopUpdate.otherName = val("otherName");
                exportUpdate["profile.otherName"] = val("otherName");
            }
            if (computedFullName) {
                userUpdate.fullName = computedFullName;
                coopUpdate.fullName = computedFullName;
                academyUpdate["personalInfo.fullName"] = computedFullName;
                farmUpdate["profile.fullName"] = computedFullName;
            }
            if (has("fullName")) {
                userUpdate.fullName = val("fullName");
                coopUpdate.fullName = val("fullName");
                academyUpdate["personalInfo.fullName"] = val("fullName");
                farmUpdate["profile.fullName"] = val("fullName");
            }
            if (has("phone")) {
                userUpdate.phone = val("phone");
                coopUpdate.phone = val("phone");
                waveUpdate.phoneNumber = val("phone");
                sellerUpdate.phone = val("phone");
                exportUpdate["profile.phone"] = val("phone");
                academyUpdate["personalInfo.phone"] = val("phone");
                farmUpdate["profile.phone"] = val("phone");
            }
            if (has("email")) {
                userUpdate.email = val("email");
                coopUpdate.email = val("email");
                waveUpdate.email = val("email");
                exportUpdate["profile.email"] = val("email");
                academyUpdate["personalInfo.email"] = val("email");
                farmUpdate["profile.email"] = val("email");
            }
            if (has("stateOfOrigin")) {
                userUpdate.stateOfOrigin = val("stateOfOrigin");
                userUpdate["address.state"] = val("stateOfOrigin");
                coopUpdate.stateOfOrigin = val("stateOfOrigin");
                coopUpdate.state = val("stateOfOrigin");
                waveUpdate.state = val("stateOfOrigin");
                sellerUpdate["location.state"] = val("stateOfOrigin");
                exportUpdate.state = val("stateOfOrigin");
            }
            if (has("lga")) {
                userUpdate.lga = val("lga");
                userUpdate["address.lga"] = val("lga");
                coopUpdate.lga = val("lga");
                sellerUpdate["location.lga"] = val("lga");
                exportUpdate.lga = val("lga");
            }
            if (has("residentialAddress")) {
                userUpdate.residentialAddress = val("residentialAddress");
                userUpdate["address.street"] = val("residentialAddress");
                coopUpdate.residentialAddress = val("residentialAddress");
                waveUpdate.residentialAddress = val("residentialAddress");
                sellerUpdate["location.address"] = val("residentialAddress");
            }
            if (has("occupation")) {
                userUpdate.occupation = val("occupation");
                coopUpdate.occupation = val("occupation");
            }

            // Next of Kin
            if (has("nextOfKin.name")) {
                userUpdate["nextOfKin.name"] = val("nextOfKin.name");
                coopUpdate["nextOfKin.name"] = val("nextOfKin.name");
            }
            if (has("nextOfKin.phone")) {
                userUpdate["nextOfKin.phone"] = val("nextOfKin.phone");
                coopUpdate["nextOfKin.phone"] = val("nextOfKin.phone");
            }
            if (has("nextOfKin.relationship")) {
                userUpdate["nextOfKin.relationship"] = val("nextOfKin.relationship");
                coopUpdate["nextOfKin.relationship"] = val("nextOfKin.relationship");
            }
            if (has("nextOfKin.address")) {
                userUpdate["nextOfKin.address"] = val("nextOfKin.address");
                coopUpdate["nextOfKin.address"] = val("nextOfKin.address");
            }

            // KYC Updates
            if (has("bvn")) {
                userUpdate.bvn = val("bvn");
                userUpdate.bvnVerified = val("bvn") ? true : false;
                coopUpdate.bvn = val("bvn");
                sellerUpdate.bvn = val("bvn");
            }
            if (has("nin")) {
                userUpdate.nin = val("nin");
                userUpdate.ninVerified = val("nin") ? true : false;
                coopUpdate.nin = val("nin");
                sellerUpdate.nin = val("nin");
            }
            if (has("cacNumber")) {
                userUpdate.cacNumber = val("cacNumber");
                userUpdate.cacVerified = val("cacNumber") ? true : false;
                sellerUpdate.cacNumber = val("cacNumber");
                sellerUpdate.cac = val("cacNumber");
            }

            // Banking details
            const checkBankField = (f: string) => {
                return val(`bankDetails.${f}`) || val(`bankAccount.${f}`) || val(f === "accountNumber" ? "accountNumber" : f === "accountName" ? "accountName" : f);
            };
            
            const bankNameVal = checkBankField("bankName");
            if (bankNameVal) {
                userUpdate["bankDetails.bankName"] = bankNameVal;
                coopUpdate["bankDetails.bankName"] = bankNameVal;
                coopUpdate.bankName = bankNameVal;
                sellerUpdate["bankAccount.bankName"] = bankNameVal;
                sellerUpdate["bankDetails.bankName"] = bankNameVal;
            }
            
            const accNumVal = checkBankField("accountNumber");
            if (accNumVal) {
                userUpdate.bankAccountNumber = accNumVal;
                userUpdate["bankDetails.accountNumber"] = accNumVal;
                coopUpdate.bankAccountNumber = accNumVal;
                coopUpdate["bankDetails.accountNumber"] = accNumVal;
                coopUpdate.accountNumber = accNumVal;
                sellerUpdate["bankAccount.accountNumber"] = accNumVal;
                sellerUpdate["bankDetails.accountNumber"] = accNumVal;
            }

            const accNameVal = checkBankField("accountName");
            if (accNameVal) {
                userUpdate.bankAccountName = accNameVal;
                userUpdate["bankDetails.accountName"] = accNameVal;
                coopUpdate.bankAccountName = accNameVal;
                coopUpdate["bankDetails.accountName"] = accNameVal;
                coopUpdate.accountName = accNameVal;
                sellerUpdate["bankAccount.accountName"] = accNameVal;
                sellerUpdate["bankDetails.accountName"] = accNameVal;
            }

            const bankCodeVal = checkBankField("bankCode");
            if (bankCodeVal) {
                userUpdate.bankCode = bankCodeVal;
                userUpdate["bankDetails.bankCode"] = bankCodeVal;
                coopUpdate["bankDetails.bankCode"] = bankCodeVal;
                coopUpdate.bankCode = bankCodeVal;
                sellerUpdate["bankAccount.bankCode"] = bankCodeVal;
                sellerUpdate["bankDetails.bankCode"] = bankCodeVal;
            }

            const meta = {
                lastEditedBy: session.user.id,
                lastEditedAt: FieldValue.serverTimestamp()
            };

            const applyIfDocExists = async (colName: string, docIdentifier: string, updatesMap: Record<string, any>) => {
                if (Object.keys(updatesMap).length === 0) return;
                const ref = db.collection(colName).doc(docIdentifier);
                const snap = await ref.get();
                if (snap.exists) {
                    syncBatch.update(ref, {
                        ...updatesMap,
                        ...meta
                    });
                }
            };

            // 1. Users
            if (Object.keys(userUpdate).length > 0) {
                syncBatch.update(db.collection(COLLECTIONS.USERS).doc(userId), {
                    ...userUpdate,
                    ...meta
                });
            }
            // 2. Cooperative Members
            await applyIfDocExists(COLLECTIONS.COOPERATIVE_MEMBERS, coopAppId, coopUpdate);
            if (coopAppId !== userId) {
                await applyIfDocExists(COLLECTIONS.COOPERATIVE_MEMBERS, userId, coopUpdate);
            }
            // 3. Wave Applications
            await applyIfDocExists(COLLECTIONS.WAVE_APPLICATIONS, waveAppId, waveUpdate);
            if (waveAppId !== `legacy_${userId}`) {
                await applyIfDocExists(COLLECTIONS.WAVE_APPLICATIONS, `legacy_${userId}`, waveUpdate);
            }
            // 4. Seller Verifications
            await applyIfDocExists(COLLECTIONS.SELLER_VERIFICATIONS, sellerAppId, sellerUpdate);
            if (sellerAppId !== `legacy_${userId}`) {
                await applyIfDocExists(COLLECTIONS.SELLER_VERIFICATIONS, `legacy_${userId}`, sellerUpdate);
            }
            // 5. Export Applications
            await applyIfDocExists(COLLECTIONS.EXPORT_APPLICATIONS, exportAppId, exportUpdate);
            if (exportAppId !== `legacy_${userId}`) {
                await applyIfDocExists(COLLECTIONS.EXPORT_APPLICATIONS, `legacy_${userId}`, exportUpdate);
            }
            // 6. Academy Applications
            await applyIfDocExists(COLLECTIONS.ACADEMY_APPLICATIONS, academyAppId, academyUpdate);
            if (academyAppId !== `legacy_${userId}`) {
                await applyIfDocExists(COLLECTIONS.ACADEMY_APPLICATIONS, `legacy_${userId}`, academyUpdate);
            }
            // 7. Farm Nation Applications
            await applyIfDocExists(COLLECTIONS.FARM_NATION_APPLICATIONS, farmAppId, farmUpdate);
            if (farmAppId !== `legacy_${userId}`) {
                await applyIfDocExists(COLLECTIONS.FARM_NATION_APPLICATIONS, `legacy_${userId}`, farmUpdate);
            }

            // If we are editing land listing directly or other fields not mapped above, update the docRef
            if (collectionName === COLLECTIONS.LAND_LISTINGS || !ALLOWED_COLLECTIONS.includes(collectionName as any)) {
                syncBatch.update(docRef, {
                    ...sanitized,
                    ...meta
                });
            }

            await syncBatch.commit();

            try {
                const { invalidateUserCache } = await import('@/lib/cache-invalidation');
                await invalidateUserCache(userId);
            } catch (cacheErr: any) {
                logger.warn("[editApplicationAction] Cache invalidation warning:", cacheErr);
            }
        } else {
            // Apply single-document update if no userId associated
            await docRef.update({
                ...sanitized,
                lastEditedBy: session.user.id,
                lastEditedAt: FieldValue.serverTimestamp(),
            });
        }

        // Write full audit trail
        await createAdminAuditLog({
            action: "admin_edit_application",
            userId: session.user.id,
            targetId: docId,
            targetType: collectionName,
            metadata: {
                adminName: session.user.name || session.user.email,
                before,
                after: sanitized,
                editNote: editNote || null,
            },
        });

        // Bust Next.js route cache so the admin users list shows fresh data
        // immediately on the next navigation without a full browser reload.
        revalidatePath('/admin/users');
        // Was '/admin/cooperative/members' — singular. The route is
        // /admin/cooperatives/members, so this invalidated nothing and the
        // admin member list kept serving a stale cache after an approval.
        revalidatePath('/admin/cooperatives/members');
        revalidatePath('/admin/export/applications');
        revalidatePath('/admin/wave/applications');
        revalidatePath('/admin/farm-nation/applications');

        return {
            success: true as const,
            error: null,
            message: "Application updated successfully",
        };
    } catch (error: any) {
        logger.error("Edit application error:", error);
        return { error: "Failed to update application: " + error.message, success: false as const };
    }
}

export const editApplicationAction = withFlexibleSafeAction("editApplicationAction", _editApplicationAction);
