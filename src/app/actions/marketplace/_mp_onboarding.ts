"use server";

import { requireSession } from "@/lib/session-guard";
import { checkModuleAccess } from "@/lib/module-access-check";
import { resolveBankAccount } from "@/lib/bank-account-resolve";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { supabaseDb as db } from "@/lib/supabase-db";
// Use Admin DB
// import { uploadFileToStorage } from "@/lib/storage-admin";

import { COLLECTIONS } from "@/lib/types/firestore";
import type { Product } from "@/lib/types/marketplace";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { MarketplaceOnboardingSchema } from "@/lib/validations/marketplace";
import { withSafeAction, ActionResponse } from "@/lib/safe-action";
import { toMillis } from "@/lib/firestore-serialize";

// ============================================
// Check Marketplace Application Status Action
// ============================================

async function _checkMarketplaceStatusAction(): Promise<ActionResponse<{ status: string; accountType: string } | null>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: "Unauthorized" };
        const { session } = sessionResult;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        let status = userData?.serviceRegistrations?.marketplace?.status;
        let accountType = userData?.serviceRegistrations?.marketplace?.accountType;

        // ── AUTHORITATIVE CHECK: Check real verification record ──────
        if (status !== "approved") {
            let verDoc: any = null;
            const verSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where("userId", "==", session.user.id)
                .get();

            if (!verSnap.empty) {
                const sortedDocs = verSnap.docs.sort((a, b) => {
                    const aTime = toMillis(a.data().createdAt);
                    const bTime = toMillis(b.data().createdAt);
                    return bTime - aTime;
                });
                verDoc = sortedDocs[0];
            } else {
                const verId = userData?.serviceRegistrations?.marketplace?.verificationId || userData?.sellerVerificationId;
                if (verId) {
                    const directDoc = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verId).get();
                    if (directDoc.exists) {
                        verDoc = directDoc;
                        // Self-healing: backfill userId on direct verification doc if missing
                        const verData = directDoc.data()!;
                        if (!verData.userId) {
                            await directDoc.ref.update({ userId: session.user.id });
                        }
                    }
                }
            }

            if (verDoc) {
                const verData = verDoc.data()!;
                if (verData.status === "approved") {
                    status = "approved";
                    accountType = verData.accountType || "seller";
                    // Proactively backfill for performance in future logins
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
                        "serviceRegistrations.marketplace.status": "approved",
                        "serviceRegistrations.marketplace.accountType": accountType,
                        "serviceRegistrations.marketplace.syncedAt": new Date().toISOString(),
                        _version: FieldValue.increment(1)
                    });
                } else if (verData.status) {
                    status = verData.status;
                    accountType = verData.accountType || accountType;
                }
            }
        }

        if (status) { return { error: null, success: true as const, data: { status, accountType } };
        }

        // ── FALLBACK: Returning user whose marketplace data predates V2 schema ──
        const legacySellerSnap = await db.collection(COLLECTIONS.MARKETPLACE_SELLERS)
            .where('userId', '==', session.user.id)
            .limit(1)
            .get();

        if (!legacySellerSnap.empty) { const legacyData = legacySellerSnap.docs[0].data();
            const legacyStatus = legacyData?.status ?? 'pending';
            const legacyAccountType = legacyData?.accountType;

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(
                {
                    "serviceRegistrations.marketplace.status": legacyStatus,
                    "serviceRegistrations.marketplace.accountType": legacyAccountType,
                    "serviceRegistrations.marketplace.syncedFromLegacy": true,
                    "serviceRegistrations.marketplace.syncedAt": new Date().toISOString(),
                    _version: FieldValue.increment(1)
                }
            );

            logger.info(`[checkMarketplaceStatus] Backfilled legacy marketplace status '${legacyStatus}' for user ${session.user.id}`);
            return { error: null, success: true as const, data: { status: legacyStatus, accountType: legacyAccountType } };
        }

        // ── FALLBACK 2: Check legacy sellerVerificationStatus field
        if (userData?.sellerVerificationStatus) { const legacyStatus = userData.sellerVerificationStatus;
            const derivedAccountType = "seller";
            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(
                { 
                    "serviceRegistrations.marketplace.status": legacyStatus,
                    "serviceRegistrations.marketplace.accountType": derivedAccountType,
                    "serviceRegistrations.marketplace.syncedFromLegacy": true,
                    "serviceRegistrations.marketplace.syncedAt": new Date().toISOString(),
                    _version: FieldValue.increment(1)
                }
            );
            return { error: null, success: true as const, data: { status: legacyStatus, accountType: derivedAccountType } };
        }

        // ── FALLBACK 3: Check seller_verifications collection
        const verificationSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where('userId', '==', session.user.id)
            .get();

        if (!verificationSnap.empty) { const sortedDocs = verificationSnap.docs.map(d => d.data()).sort((a, b) => {
                const aTime = toMillis((a as any).createdAt);
                const bTime = toMillis((b as any).createdAt);
                return bTime - aTime;
            });
            const vData = sortedDocs[0];
            const vStatus = vData?.status ?? 'pending';
            const vAccountType = vData?.accountType ?? 'seller';

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(
                {
                    "serviceRegistrations.marketplace.status": vStatus,
                    "serviceRegistrations.marketplace.accountType": vAccountType,
                    "serviceRegistrations.marketplace.syncedFromLegacy": true,
                    "serviceRegistrations.marketplace.syncedAt": new Date().toISOString(),
                    _version: FieldValue.increment(1)
                }
            );

            logger.info(`[checkMarketplaceStatus] Backfilled from seller_verifications status '${vStatus}' for user ${session.user.id}`);
            return { error: null, success: true as const, data: { status: vStatus, accountType: vAccountType } };
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        logger.error("checkMarketplaceStatus error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to check marketplace status", data: null };
    }
}

export const checkMarketplaceStatusAction = withSafeAction("checkMarketplaceStatusAction", _checkMarketplaceStatusAction);


/**
 * Submit full marketplace onboarding (Profile + Verification + Files)
 */
/**
 * Submit full marketplace onboarding (Profile + Verification + Files)
 */
async function _submitMarketplaceOnboardingAction(
    formData: FormData
): Promise<ActionResponse<null>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const timestamp = Date.now();

        // Check for existing application
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.marketplace?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') { 
            return { success: false as const, error: "Your previous application is still being processed.", data: null };
        }
        if (existingStatus === 'approved') { 
            return { success: false as const, error: "You are already registered for Marketplace.", data: null };
        }

        // DISEASE 6 FIX: Validate the fields this action actually reads from FormData.
        // MarketplaceOnboardingSchema has different field names than the form, so we
        // inline-validate the minimum required fields here to prevent empty submissions.
        const accountType = formData.get("accountType") as string;
        const businessName = formData.get("businessName") as string;
        if (!accountType) {
            return { success: false as const, error: "Account type is required.", data: null };
        }
        if (!businessName?.trim()) {
            return { success: false as const, error: "Business name is required.", data: null };
        }
        if (!["seller", "buyer", "both"].includes(accountType)) {
            return { success: false as const, error: "Invalid account type.", data: null };
        }


        // EVERY validation first, then the uploads.
        //
        // The location, bank-account and JSON checks used to run AFTER the file
        // uploads, so a submission that failed any of them had already written a
        // business registration, farm photos and product samples to storage. The
        // seller saw an error, retried, and uploaded them all again — orphaned
        // copies accumulating in the bucket on every failed attempt, none of them
        // referenced by any record.
        //
        // Nothing below this block touches storage until the request is known to
        // be complete.
        const parseJsonField = <T,>(key: string, fallback: T): { ok: true; value: T } | { ok: false } => {
            const raw = formData.get(key) as string | null;
            if (!raw) return { ok: true, value: fallback };
            try {
                return { ok: true, value: JSON.parse(raw) as T };
            } catch {
                // `sellerCategories` and `certifications` were parsed with no
                // guard at all, while `location` and `bankAccount` twenty lines
                // away were wrapped. A malformed value threw into the outer catch
                // and the seller was told "Failed to submit" with no clue which
                // field was wrong — after the uploads had already happened.
                logger.warn("Malformed JSON in onboarding field", { userId, key });
                return { ok: false };
            }
        };

        const locationParsed = parseJsonField<{ state?: string; lga?: string; address?: string }>("location", {});
        if (!locationParsed.ok) {
            return { success: false as const, error: "Location details could not be read. Please re-enter them.", data: null };
        }
        const location = locationParsed.value ?? {};

        if (!location?.state || !location?.lga || !location?.address) {
            return { success: false as const, error: "Location details (State, LGA, Address) are required.", data: null };
        }

        const bankParsed = parseJsonField<{
            bankName?: string; accountNumber?: string; accountName?: string; bankCode?: string;
        }>("bankAccount", {});
        if (!bankParsed.ok) {
            return { success: false as const, error: "Bank account details could not be read. Please re-enter them.", data: null };
        }
        const bankAccount = bankParsed.value ?? {};

        const isSeller = accountType === "seller" || accountType === "both";
        if (isSeller && (!bankAccount?.bankName || !bankAccount?.accountNumber || !bankAccount?.accountName)) {
            return { success: false as const, error: "Bank account details (Bank Name, Account Number, Account Name) are required.", data: null };
        }

        /**
         *   #346 SECURITY: THE SELLER'S PAYOUT ACCOUNT NAME WAS WHATEVER THE
         *        REQUEST SAID IT WAS.
         *
         *        #284 made the onboarding component resolve the account through
         *        Paystack instead of simulating it. This action — the thing
         *        that WRITES the record — never checked: it required the three
         *        strings above to be non-empty and stored them. The browser was
         *        the whole control, and #346 found two ways past it in the
         *        component itself before even considering a crafted request.
         *
         *        This is a marketplace SELLER. `bankDetails.accountName` is
         *        what the admin payout queue displays, what an approver checks
         *        the transfer against, and what the escrow release pays out
         *        towards.
         *
         *        The account is re-resolved here and the BANK'S name is what
         *        gets stored — the submitted `accountName` is never written.
         *        Failing closed is deliberate: an account that cannot be
         *        resolved is not a verified one, and recording it anyway is the
         *        defect being closed. Buyers are unaffected — they have no
         *        payout account, so this runs for sellers only.
         */
        let resolvedAccountName = "";
        if (isSeller) {
            const resolution = await resolveBankAccount(bankAccount.accountNumber, bankAccount.bankCode);
            if (!resolution.ok) {
                return {
                    success: false as const,
                    error: resolution.reason
                        || "We could not confirm that bank account. Please verify it again before submitting.",
                    data: null,
                };
            }
            resolvedAccountName = resolution.accountName ?? "";
        }

        // The record. `accountName` is the BANK'S answer for a seller; the
        // submitted one is never stored. A buyer has no payout account, so
        // there is nothing to resolve and nothing here to be wrong.
        const bankAccountRecord = isSeller
            ? { ...bankAccount, accountName: resolvedAccountName, verified: true }
            : bankAccount;

        const categoriesParsed = parseJsonField<string[]>("sellerCategories", []);
        const certificationsParsed = parseJsonField<string[]>("certifications", []);
        if (!categoriesParsed.ok || !certificationsParsed.ok) {
            return { success: false as const, error: "Categories or certifications could not be read. Please re-select them.", data: null };
        }
        const sellerCategories = categoriesParsed.value ?? [];
        const certifications = certificationsParsed.value ?? [];

        // 1. Handle File Uploads (Admin SDK Storage)
        const uploadFile = async (file: File, path: string) => {
            const extension = file.name.split('.').pop();
            const fileName = `${timestamp}_${Math.random().toString(36).substring(7)}.${extension}`;
            const destination = `${path}/${userId}/${fileName}`;

            // #280 This said "Use signed URLs (private/secure) for verification
            // docs". There are no signed URLs and there never were on this
            // path: uploadFileToStorage sends no authenticated type, so a
            // seller's business registration document is a public Cloudinary
            // URL. The comment is corrected rather than deleted because it
            // records what this call was MEANT to do, which is what the owner
            // has to decide about.
            const { uploadFileToStorage } = await import("@/lib/storage-admin");
            return await uploadFileToStorage(file, destination);
        };

        let businessRegistrationUrl = "";
        const farmPhotoUrls: string[] = [];
        const productSampleUrls: string[] = [];

        // Upload Business Registration
        const bizRegFile = formData.get("businessRegistration") as File;
        if (bizRegFile && bizRegFile.size > 0) { 
            businessRegistrationUrl = await uploadFile(bizRegFile, "start_selling/documents");
        }

        // Upload Farm Photos
        for (const key of Array.from(formData.keys())) { 
            if (key.startsWith("farmPhotos_")) {
                const file = formData.get(key) as File;
                if (file.size > 0) {
                    const url = await uploadFile(file, "start_selling/farm_photos");
                    farmPhotoUrls.push(url);
                }
            }
        }

        // Upload Product Samples
        for (const key of Array.from(formData.keys())) { 
            if (key.startsWith("productSamples_")) {
                const file = formData.get(key) as File;
                if (file.size > 0) {
                    const url = await uploadFile(file, "start_selling/product_samples");
                    productSampleUrls.push(url);
                }
            }
        }

        // 2. Prepare Data — location, bankAccount, categories and
        // certifications were all parsed and validated above, before any upload.

        const verificationId = `seller_${userId}_${timestamp}`;
        const verificationRef = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId);

        const verificationData = { 
            id: verificationId,
            userId,
            status: "pending",
            businessName: formData.get("businessName"),
            businessType: formData.get("businessType"),
            phone: formData.get("phone"),
            location,
            sellerCategory: (formData.get("sellerCategory") as string) || "retail",
            accountType: formData.get("accountType"), 
            sellerCategories,
            productionCapacity: formData.get("productionCapacity"),
            certifications,
            documents: {
                businessRegistrationUrl,
                farmPhotoUrls,
                productSampleUrls 
            },
            bankAccount: bankAccountRecord,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0 
        };

        // Save to Firestore using a transaction for atomicity
        await db.runTransaction(async (transaction) => {
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const accountType = formData.get("accountType") as string;
            const isBuyerOnly = accountType === "buyer";

            if (!isBuyerOnly) {
                transaction.set(verificationRef, verificationData);
            }

            const userUpdate: Record<string, any> = {
                phone: formData.get("phone") as string,
                location: `${location.address}, ${location.lga}, ${location.state}`,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) 
            };

            // Replicate bankAccount to user root bankDetails (DISEASE 6 / Save Bank Account Details fix)
            if (bankAccountRecord?.accountNumber) {
                userUpdate.bankDetails = {
                    accountNumber: bankAccountRecord.accountNumber,
                    bankName: bankAccountRecord.bankName || "",
                    // #346 the resolved name for a seller, never the typed one.
                    accountName: bankAccountRecord.accountName || "",
                    bankCode: (bankAccountRecord as any).bankCode || ""
                };
            }

            // Replicate location address to user root address object
            if (location?.address) {
                userUpdate.address = {
                    street: location.address,
                    city: "",
                    state: location.state || "",
                    lga: location.lga || "",
                    country: "Nigeria"
                };
                userUpdate.residentialAddress = location.address;
                userUpdate.stateOfOrigin = location.state;
                userUpdate.lga = location.lga;
            }

            const canonicalProfile = {
                firstName: userDoc.data()?.firstName || "",
                lastName: userDoc.data()?.lastName || "",
                fullName: userDoc.data()?.fullName || "",
                phone: formData.get("phone") as string,
                email: userDoc.data()?.email || "",
                business: {
                    name: formData.get("businessName") as string,
                    type: formData.get("businessType") as string,
                    description: formData.get("businessDescription") as string || "",
                    address: location.address,
                    state: location.state,
                    lga: location.lga,
                    category: (formData.get("sellerCategory") as string) || "retail"
                },
                bankDetails: bankAccountRecord,
                documents: {
                    businessDoc: businessRegistrationUrl || undefined,
                    farmPhotos: farmPhotoUrls,
                    productSamples: productSampleUrls
                },
                status: isBuyerOnly ? "approved" : "pending",
                lastUpdated: FieldValue.serverTimestamp()
            };

            userUpdate.verificationProfile = {
                ...canonicalProfile,
                isCanonical: true
            };

            if (isBuyerOnly) { 
                userUpdate["serviceRegistrations.marketplace"] = {
                    status: "active",
                    paymentStatus: "completed",
                    accountType: "buyer",
                    sellerCategory: "retail",
                    submittedAt: FieldValue.serverTimestamp() 
                };
                const existingRoles = userDoc.data()?.roles || ["general_user"];
                if (!existingRoles.includes("marketplace_buyer")) { 
                    userUpdate.roles = [...existingRoles, "marketplace_buyer"];
                }
            } else { 
                userUpdate.isSeller = true;
                userUpdate.sellerVerificationStatus = "pending";
                userUpdate.sellerVerificationId = verificationId;
                userUpdate.sellerCategory = formData.get("sellerCategory") as string || "retail";
                userUpdate["serviceRegistrations.marketplace"] = {
                    status: "pending",
                    paymentStatus: "completed",
                    verificationId,
                    accountType: accountType,
                    sellerCategory: formData.get("sellerCategory") as string || "retail",
                    submittedAt: FieldValue.serverTimestamp() 
                };
            }

            transaction.update(userRef, userUpdate);
        });

        try { 
            await invalidateUserCache(userId);
        } catch (err) { 
            logger.error("Failed to invalidate cache after Marketplace Onboarding:", { userId, error: err });
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        logger.error("Marketplace onboarding error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to submit application", data: null };
    }
}

export const submitMarketplaceOnboardingAction = withSafeAction("submitMarketplaceOnboardingAction", _submitMarketplaceOnboardingAction);


async function _checkMarketplaceAccessAction(): Promise<ActionResponse<boolean>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: "Session expired", data: null };
        }
        const hasAccess = await checkModuleAccess(
            sessionResult.session.user.id,
            sessionResult.session.user.roles || [],
            "marketplace"
        );
        return { success: true as const, error: null, data: hasAccess };
    } catch (error) {
        logger.error("checkMarketplaceAccessAction error:", error);
        return { success: false as const, error: "Failed to verify access", data: null };
    }
}

export const checkMarketplaceAccessAction = withSafeAction("checkMarketplaceAccessAction", _checkMarketplaceAccessAction);
