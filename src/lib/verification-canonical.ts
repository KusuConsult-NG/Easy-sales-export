
import { db } from "./firebase-admin";
import { COLLECTIONS } from "./types/firestore";

/**
 * CANONICAL VERIFICATION SCHEMA
 *
 *   #355 NOTHING IMPORTS THIS FILE, SO IT IS THE AUTHORITATIVE WAY TO DO
 *        NOTHING.
 *
 *        Its header said "This module provides the authoritative way to read
 *        and write user verification data. It abstracts away the fragmented
 *        legacy collections." The intent is sound and the fragmentation is
 *        real — #25 found verificationStatus written as a string by four
 *        callers and as an object by three — but this module was never
 *        adopted, so that fragmentation is still there and every caller still
 *        reads whichever collection it happens to know about.
 *
 *        Two exports, zero callers, 0% coverage.
 *
 *        KEPT, not deleted. The header now says what it is rather than what it
 *        was meant to become, so the next reader does not take it for the
 *        abstraction the codebase already has.
 *
 *        OWNER DECISION: adopt it — which means moving the seven writers #25
 *        found onto it — or retire it.
 */

export interface CanonicalVerificationProfile {
    // Identity
    fullName: string;
    firstName: string;
    lastName: string;
    otherNames?: string;
    phone: string;
    email: string;
    dob: string;

    // Business (if applicable)
    business?: {
        name: string;
        type: string;
        description: string;
        address: string;
        state: string;
        lga: string;
        category: "wholesale" | "retail";
    };

    // Bank Details
    bankDetails: {
        bankName: string;
        accountNumber: string;
        accountName: string;
        bankCode?: string;
    };

    // Documents
    documents: {
        idDoc?: string;        // URL
        businessDoc?: string;  // URL
        addressProof?: string; // URL
        selfie?: string;       // URL
    };

    // Verification Status
    status: "pending" | "approved" | "rejected" | "suspended";
    verifiedAt?: any;
    verifiedBy?: string;
    rejectionReason?: string;
    lastUpdated: any;
}

/**
 * READ: Assemble the canonical profile from all available sources.
 * Priority: Root User > Seller Verifications > Cooperative Members > WAVE
 */
export async function getCanonicalProfile(userId: string): Promise<CanonicalVerificationProfile | null> {
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) return null;

    const uData = userDoc.data()!;
    
    // 1. Start with Root User Data
    const profile: Partial<CanonicalVerificationProfile> = {
        fullName: uData.fullName || uData.firstName + " " + uData.lastName,
        firstName: uData.firstName,
        lastName: uData.lastName,
        phone: uData.phone,
        email: uData.email,
        dob: uData.dob || uData.kyc?.dateOfBirth,
        bankDetails: uData.bankDetails || uData.kyc?.bankDetails || {
            bankName: "N/A",
            accountNumber: "N/A",
            accountName: "N/A"
        },
        documents: uData.documents || uData.kyc?.documents || {},
        status: uData.sellerVerificationStatus || uData.kyc?.status || "pending",
        lastUpdated: uData.updatedAt
    };

    // 2. Supplement from Seller Verifications (usually has better business/doc data)
    const sellerSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

    if (!sellerSnap.empty) {
        const sData = sellerSnap.docs[0].data();
        profile.business = {
            name: sData.businessName || profile.business?.name || "",
            type: sData.businessType || profile.business?.type || "",
            description: sData.businessDescription || profile.business?.description || "",
            address: sData.address || sData.residentialAddress || profile.business?.address || "",
            state: sData.state || sData.stateOfOrigin || profile.business?.state || "",
            lga: sData.lga || profile.business?.lga || "",
            category: sData.sellerCategory || profile.business?.category || "retail"
        };

        // Bank Fallback
        if (profile.bankDetails?.accountNumber === "N/A") {
            profile.bankDetails = {
                bankName: sData.bankDetails?.bankName || sData.bankName || "N/A",
                accountNumber: sData.bankDetails?.accountNumber || sData.accountNumber || "N/A",
                accountName: sData.bankDetails?.accountName || sData.accountName || "N/A"
            };
        }

        // Document Fallback
        profile.documents = {
            ...profile.documents,
            ...sData.documents
        };
    }

    return profile as CanonicalVerificationProfile;
}

/**
 * WRITE: Atomic update to canonical profile and all relevant sub-collections.
 */
export async function updateCanonicalProfile(userId: string, updates: Partial<CanonicalVerificationProfile>, adminId?: string) {
    return await db.runTransaction(async (transaction) => {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        
        // 1. Update Root User (Primary Source of Truth)
        const userUpdate: any = {
            updatedAt: new Date(),
            ...updates
        };

        // Flatten for root user if necessary (legacy compatibility)
        if (updates.bankDetails) userUpdate.bankDetails = updates.bankDetails;
        if (updates.business) {
            userUpdate.businessName = updates.business.name;
            userUpdate.businessType = updates.business.type;
        }

        transaction.update(userRef, userUpdate);

        // 2. Sync to Seller Verifications (if exists)
        const sellerSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", userId)
            .get();
        
        sellerSnap.forEach(doc => {
            transaction.update(doc.ref, {
                ...updates,
                updatedAt: new Date()
            });
        });

        // 3. Sync to other modules... (OMITTED for brevity, but same pattern)
    });
}
