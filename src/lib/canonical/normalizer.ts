
import { CanonicalUserProfile, LATEST_SCHEMA_VERSION } from "./schemas";

/**
 * AGGRESSIVE CANONICAL NORMALIZER (V3)
 * 
 * Reconciles EVERY available field across root users, sellers, coop members, and WAVE apps.
 */

export function normalizeAggressive(
    userId: string, 
    uData: any = {}, 
    sData: any = null, 
    cData: any = null, 
    wData: any = null
): CanonicalUserProfile {
    // Helper to ignore "N/A" strings as falsy
    const cleanVal = (val: any) => (val && val !== "N/A" && val !== "undefined" && val !== "null") ? val : null;

    // 1. Resolve Identity (Strict Priority: WAVE > User > Seller)
    const fullName = cleanVal(uData.fullName) || 
                   cleanVal(uData.displayName) || 
                   (cleanVal(uData.firstName) && cleanVal(uData.lastName) ? `${uData.firstName} ${uData.lastName}` : null) || 
                   cleanVal(wData?.fullName) || 
                   (cleanVal(wData?.firstName) && cleanVal(wData?.surname) ? `${wData.firstName} ${wData.surname}` : null) ||
                   cleanVal(sData?.businessName) ||
                   "Unknown User";

    const firstName = cleanVal(uData.firstName) || cleanVal(wData?.firstName) || fullName.split(" ")[0] || "";
    const lastName = cleanVal(uData.lastName) || cleanVal(wData?.surname) || fullName.split(" ").slice(1).join(" ") || "";

    const email = cleanVal(uData.email) || cleanVal(wData?.userEmail) || cleanVal(sData?.email) || "";
    const phone = cleanVal(uData.phone) || cleanVal(sData?.phone) || cleanVal(wData?.phone) || cleanVal(uData.phoneNumber) || cleanVal(uData.kyc?.phoneNumber) || cleanVal(uData.kyc?.phone) || cleanVal(sData?.phoneNumber) || cleanVal(sData?.kyc?.phoneNumber) || cleanVal(sData?.kyc?.phone) || cleanVal(wData?.phoneNumber) || cleanVal(wData?.kyc?.phoneNumber) || cleanVal(wData?.kyc?.phone) || "";
    const gender = cleanVal(uData.gender) || cleanVal(wData?.gender) || "";
    const dob = cleanVal(uData.dateOfBirth) || cleanVal(wData?.dateOfBirth) || cleanVal(cData?.personalInfo?.dateOfBirth) || "";

    // 2. Resolve Bank Details (Aggressive fallback)
    const bankDetails = {
        bankName:      cleanVal(uData.bankDetails?.bankName)      || cleanVal(wData?.bankName)      || cleanVal(cData?.bankDetails?.bankName)      || cleanVal(sData?.bankAccount?.bankName)      || cleanVal(uData.bankName)      || "",
        accountNumber: cleanVal(uData.bankDetails?.accountNumber) || cleanVal(wData?.accountNumber) || cleanVal(cData?.bankDetails?.accountNumber) || cleanVal(sData?.bankAccount?.accountNumber) || cleanVal(uData.accountNumber) || "",
        accountName:   cleanVal(uData.bankDetails?.accountName)   || cleanVal(cData?.bankDetails?.accountName)   || cleanVal(sData?.bankAccount?.accountName)   || cleanVal(uData.fullName) || fullName || "",
        bankCode:      cleanVal(uData.bankDetails?.bankCode)      || cleanVal(cData?.bankDetails?.bankCode)      || cleanVal(sData?.bankAccount?.bankCode)      || cleanVal(uData.bankCode) || ""
    };

    // 3. Resolve KYC / Identity (NIN/BVN)
    const nin = cleanVal(uData.nin) || cleanVal(wData?.nin) || cleanVal(sData?.nin) || "";
    const bvn = cleanVal(uData.bvn) || cleanVal(wData?.bvn) || cleanVal(sData?.bvn) || cleanVal(cData?.documents?.bvn) || "";

    // 4. Resolve Address
    const address = {
        street: cleanVal(uData.address?.street) || cleanVal(uData.residentialAddress) || cleanVal(wData?.residentialAddress) || cleanVal(cData?.residentialAddress) || cleanVal(sData?.address?.street) || "",
        city: cleanVal(uData.address?.city) || cleanVal(sData?.address?.city) || "",
        state: cleanVal(uData.address?.state) || cleanVal(uData.stateOfOrigin) || cleanVal(wData?.stateOfOrigin) || cleanVal(cData?.stateOfOrigin) || cleanVal(sData?.address?.state) || "",
        lga: cleanVal(uData.address?.lga) || cleanVal(uData.lga) || cleanVal(wData?.lgaOfOrigin) || cleanVal(cData?.lga) || cleanVal(sData?.address?.lga) || "",
        country: "Nigeria"
    };

    // 5. Resolve Documents (Aggregate from all sources)
    const documents = {
        idCard: sData?.documents?.idDoc || sData?.documents?.idCard || cData?.documents?.validId || uData.documents?.idDoc || null,
        businessCert: sData?.documents?.businessDoc || sData?.documents?.businessCertificate || uData.documents?.businessDoc || null,
        addressProof: sData?.documents?.addressProof || cData?.documents?.proofOfAddress || uData.documents?.addressProof || null,
        passportPhoto: cData?.documents?.passportPhoto || uData.documents?.passportPhoto || null,
    };

    // Clean nulls from documents
    const cleanDocs: Record<string, any> = {};
    Object.entries(documents).forEach(([k, v]) => { if (v) cleanDocs[k] = v; });

    // 6. Resolve Module Statuses
    const marketplaceStatus = sData?.status || uData.sellerVerificationStatus || "not_started";
    const cooperativeStatus = cData?.status || uData.serviceRegistrations?.cooperative?.status || (cData ? "active" : "not_started");
    const waveStatus = wData?.status || uData.serviceRegistrations?.wave?.status || (wData ? "submitted" : "not_started");

    return {
        uid: userId,
        email,
        fullName,
        firstName,
        lastName,
        phone,
        gender: gender as any,
        dateOfBirth: dob,
        roles: Array.isArray(uData.roles) ? uData.roles : [],
        isVerified: !!(uData.isVerified || uData.verified || marketplaceStatus === "approved"),
        onboardingCompleted: !!(uData.onboardingCompleted || sData || cData || wData),
        address,
        bankDetails,
        nin,
        bvn,
        verificationProfile: {
            status: marketplaceStatus,
            bankDetails,
            address, // Adding address to profile for easier auditing
            documents: cleanDocs,
            isCanonical: true,
            schemaVersion: LATEST_SCHEMA_VERSION,
            nin,
            bvn
        } as any,
        serviceRegistrations: {
            marketplace: { status: marketplaceStatus },
            cooperative: { status: cooperativeStatus },
            wave: { status: waveStatus },
            academy: uData.serviceRegistrations?.academy || { status: "not_started" },
            export: uData.serviceRegistrations?.export || { status: "not_started" },
            farmNation: uData.serviceRegistrations?.farmNation || { status: "not_started" }
        },
        createdAt: uData.createdAt?.toDate?.() || new Date(),
        updatedAt: new Date(),
        schemaVersion: LATEST_SCHEMA_VERSION
    };
}

/**
 * EXTRACTS CANONICAL DATA FROM A USER DOCUMENT
 * 
 * Used for UI hydration loops to ensure we ALWAYS read from the SSOT fields,
 * with fallbacks to legacy fields if the SSOT hasn't been synced yet.
 */
export function extractCanonicalUser(uData: any, appData: any = null) {
    const profile = uData?.verificationProfile;
    
    // 1. BANK DETAILS (SSOT Priority)
    const bankDetails = {
        bankName:      profile?.bankDetails?.bankName      || uData?.bankDetails?.bankName      || uData?.bankName      || appData?.bankName      || appData?.bankAccount?.bankName      || "",
        accountNumber: profile?.bankDetails?.accountNumber || uData?.bankDetails?.accountNumber || uData?.accountNumber || appData?.accountNumber || appData?.bankAccount?.accountNumber || "",
        accountName:   profile?.bankDetails?.accountName   || uData?.bankDetails?.accountName   || uData?.accountName   || appData?.accountName   || appData?.bankAccount?.accountName   || uData?.fullName || "",
        bankCode:      profile?.bankDetails?.bankCode      || uData?.bankDetails?.bankCode      || uData?.bankCode      || appData?.bankCode      || appData?.bankAccount?.bankCode      || "",
    };

    // 2. ADDRESS (SSOT Priority)
    const address = {
        street: profile?.address?.street || uData?.address?.street || uData?.residentialAddress || uData?.street || appData?.residentialAddress || appData?.address?.street || appData?.address || "",
        state:  profile?.address?.state  || uData?.address?.state  || uData?.state || uData?.stateOfOrigin || appData?.state || appData?.stateOfOrigin || appData?.stateOfResidence || appData?.residentialState || appData?.address?.state || "",
        lga:    profile?.address?.lga    || uData?.address?.lga    || uData?.lga   || appData?.lga   || appData?.lgaOfOrigin   || appData?.lgaOfResidence   || appData?.residentialLga   || appData?.address?.lga   || "",
    };

    // 3. IDENTITY
    const name = uData?.fullName || uData?.name || (uData?.firstName && uData?.lastName ? `${uData.firstName} ${uData.lastName}` : appData?.fullName || appData?.name || "");

    return {
        name,
        email: uData?.email || appData?.email || appData?.userEmail || "",
        phone: uData?.phone || uData?.phoneNumber || uData?.kyc?.phoneNumber || uData?.kyc?.phone || appData?.phone || appData?.phoneNumber || appData?.kyc?.phoneNumber || appData?.kyc?.phone || "",
        dateOfBirth: uData?.dateOfBirth || appData?.dateOfBirth || "",
        gender: uData?.gender || appData?.gender || appData?.personalInfo?.gender || appData?.profile?.gender || profile?.gender || "",
        bankDetails,
        address,
        nin: profile?.nin || uData?.nin || appData?.nin || "",
        bvn: profile?.bvn || uData?.bvn || appData?.bvn || "",
    };
}

