
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
    
    // 1. Resolve Identity (Strict Priority: WAVE > User > Seller)
    // WAVE is often the most recent "full" onboarding form
    const fullName = uData.fullName || 
                   (uData.firstName && uData.lastName ? `${uData.firstName} ${uData.lastName}` : "") || 
                   wData?.fullName || 
                   (wData?.firstName && wData?.surname ? `${wData.firstName} ${wData.surname}` : "") ||
                   sData?.businessName ||
                   "Unknown User";

    const firstName = uData.firstName || wData?.firstName || fullName.split(" ")[0] || "";
    const lastName = uData.lastName || wData?.surname || fullName.split(" ").slice(1).join(" ") || "";

    const email = uData.email || wData?.userEmail || sData?.email || "";
    const phone = uData.phone || sData?.phone || wData?.phone || uData.phoneNumber || "";
    const gender = uData.gender || wData?.gender || "other";
    const dob = uData.dateOfBirth || wData?.dateOfBirth || cData?.personalInfo?.dateOfBirth || "";

    // 2. Resolve Bank Details
    const bankDetails = {
        bankName: sData?.bankDetails?.bankName || wData?.bankName || cData?.bankDetails?.bankName || uData.bankDetails?.bankName || uData.bankName || "N/A",
        accountNumber: sData?.bankDetails?.accountNumber || wData?.accountNumber || cData?.bankDetails?.accountNumber || uData.bankDetails?.accountNumber || uData.accountNumber || "N/A",
        accountName: sData?.bankDetails?.accountName || wData?.accountName || cData?.bankDetails?.accountName || uData.bankDetails?.accountName || uData.accountName || fullName,
    };

    // 3. Resolve KYC / Identity (NIN/BVN)
    const nin = uData.nin || wData?.nin || "";
    const bvn = uData.bvn || wData?.bvn || cData?.documents?.bvn || "";

    // 4. Resolve Documents (Aggregate from all sources)
    const documents = {
        idCard: sData?.documents?.idDoc || sData?.documents?.idCard || cData?.documents?.validId || uData.documents?.idDoc || null,
        businessCert: sData?.documents?.businessDoc || sData?.documents?.businessCertificate || uData.documents?.businessDoc || null,
        addressProof: sData?.documents?.addressProof || cData?.documents?.proofOfAddress || uData.documents?.addressProof || null,
        passportPhoto: cData?.documents?.passportPhoto || uData.documents?.passportPhoto || null,
    };

    // Clean nulls from documents
    const cleanDocs: Record<string, any> = {};
    Object.entries(documents).forEach(([k, v]) => { if (v) cleanDocs[k] = v; });

    // 5. Resolve Module Statuses
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
        address: uData.address || {
            street: uData.residentialAddress || wData?.residentialAddress || cData?.personalInfo?.address || "",
            city: "",
            state: uData.stateOfOrigin || wData?.stateOfOrigin || cData?.personalInfo?.state || "",
            lga: uData.lga || wData?.lgaOfOrigin || cData?.personalInfo?.lga || "",
            country: "Nigeria"
        },
        verificationProfile: {
            status: marketplaceStatus,
            bankDetails,
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
