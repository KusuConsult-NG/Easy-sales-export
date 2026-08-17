/**
 * One read-shape for a seller verification, from the two shapes we write.
 *
 * THREE SHAPES FOR ONE RECORD
 * ---------------------------
 * SELLER_VERIFICATIONS has two writers and one reader, and none of the three
 * agrees with the others.
 *
 *   submitSellerVerificationAction (_mp_seller_verification.ts)
 *       phoneNumber
 *       address: { street, city, state, lga, country }     <- an OBJECT
 *       bankAccount: { accountNumber, bankName, accountName, bankCode }
 *       no businessName, no documents
 *
 *   submitMarketplaceOnboardingAction (_mp_onboarding.ts)
 *       phone
 *       location: { state, lga, address }
 *       bankAccount: { bankName, accountNumber, accountName }
 *       businessName
 *       documents: { businessRegistrationUrl, farmPhotoUrls[], productSampleUrls[] }
 *
 *   admin/marketplace/sellers/page.tsx  (the reader)
 *       phone
 *       address: string                                     <- flat
 *       state, lga                                          <- flat
 *       bankDetails: { bankName, accountNumber, accountName }
 *       documents: { businessDoc, idDoc, addressProof }
 *
 * WHAT THE ADMIN ACTUALLY SAW
 * ---------------------------
 * Address, state and LGA blank for BOTH paths — neither writer stores them
 * where the reader looks. Business name and phone blank for applications
 * submitted through the verification form.
 *
 * All three documents rendered as "Not uploaded" for both paths. The admin
 * reads `documents.businessDoc / idDoc / addressProof`; normalizeAggressive
 * supplies `businessCert / idCard / addressProof`, so two of the three names
 * never line up — and the SOURCES it draws from
 * (`sData.documents.businessDoc`, `.businessCertificate`) are not what
 * onboarding writes either, which is `businessRegistrationUrl`. A seller's
 * uploaded business registration was therefore unreachable under any name.
 *
 * BANK DETAILS ARE FINE — CORRECTING MY OWN FIRST DRAFT
 * ----------------------------------------------------
 * This comment first claimed every bank field showed "N/A" because the writers
 * store `bankAccount` and the reader reads `bankDetails`. That is wrong.
 * getStandardSellerVerificationsAction runs normalizeAggressive, which falls
 * back through `sData?.bankAccount?.*`, and injects the result as
 * `data.bankDetails`. Bank details resolve correctly today. The adapter below
 * keeps that fallback rather than replacing it.
 *
 * So the screen an admin approves a seller from was missing its address and
 * its documents — not everything, but the parts a verification decision rests
 * on.
 *
 * AND ONE OF THEM CRASHED THE PAGE
 * --------------------------------
 * The detail modal renders `{data.address}` directly. For a record written by
 * submitSellerVerificationAction that value is an object, and React throws
 * "Objects are not valid as a React child" — which unmounts the tree. Opening
 * the detail view of such an application took the admin screen down.
 *
 * WHY AN ADAPTER RATHER THAN A MIGRATION
 * --------------------------------------
 * Records already exist in both shapes. Changing what the writers store fixes
 * nothing already written, and a backfill is a data migration with its own
 * risk. Normalising on READ fixes every existing record immediately and is
 * reversible by deleting one file. The writers are left alone deliberately.
 */

export interface NormalisedSellerVerification {
    businessName: string;
    businessType: string;
    phone: string;
    email: string;
    /** Flat, always a string — never the object that crashed the modal. */
    address: string;
    state: string;
    lga: string;
    bankDetails: { bankName: string; accountNumber: string; accountName: string };
    documents: { businessDoc: string; idDoc: string; addressProof: string };
    /** Everything else, untouched, so nothing this does not know about is lost. */
    [key: string]: any;
}

function str(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    // Deliberately NOT String(object) — "[object Object]" on an admin screen is
    // worse than a blank, and it is what a careless fix here would produce.
    return "";
}

/** Joins the parts of an address object into something readable. */
function flattenAddress(value: any): string {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value !== "object") return "";

    const parts = [value.street, value.address, value.city, value.lga, value.state, value.country]
        .map(str)
        .map((p) => p.trim())
        .filter(Boolean);

    // De-duplicate: `location` carries lga and state that often repeat what the
    // address line already says.
    const seen = new Set<string>();
    return parts.filter((p) => {
        const key = p.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).join(", ");
}

/**
 * Maps a stored verification onto the shape the admin screen reads.
 *
 * Every field falls back across both writers' spellings. Unknown fields are
 * preserved, so the raw-data view still shows everything.
 */
export function normaliseSellerVerification(raw: Record<string, any> | null | undefined): NormalisedSellerVerification {
    const v = raw ?? {};

    // `address` object (verification form) or `location` object (onboarding).
    const addressSource = v.address ?? v.location;
    const addressObject = addressSource && typeof addressSource === "object" ? addressSource : null;

    const bank = v.bankDetails ?? v.bankAccount ?? {};
    const docs = v.documents ?? {};

    return {
        ...v,
        businessName: str(v.businessName) || str(v.storeName) || str(v.businessInfo?.name),
        businessType: str(v.businessType),
        // Both spellings. The verification form writes phoneNumber, onboarding
        // writes phone, and the reader only ever looked for phone.
        phone: str(v.phone) || str(v.phoneNumber),
        email: str(v.email) || str(v.userEmail),
        address: flattenAddress(addressSource),
        // Flat, from wherever the object put them.
        state: str(v.state) || str(addressObject?.state),
        lga: str(v.lga) || str(addressObject?.lga),
        bankDetails: {
            bankName: str(bank.bankName),
            accountNumber: str(bank.accountNumber),
            accountName: str(bank.accountName),
        },
        documents: {
            // Every spelling in play: what the admin reads (businessDoc/idDoc),
            // what normalizeAggressive emits (businessCert/idCard), and what
            // onboarding actually writes (businessRegistrationUrl).
            businessDoc:
                str(docs.businessDoc)
                || str(docs.businessCert)
                || str(docs.businessCertificate)
                || str(docs.businessRegistrationUrl),
            idDoc: str(docs.idDoc) || str(docs.idCard) || str(docs.idDocumentUrl),
            addressProof: str(docs.addressProof) || str(docs.proofOfAddress) || str(docs.addressProofUrl),
            // A farm photo is NOT proof of address and is deliberately not mapped
            // to any of the three above — showing one under that label would be
            // worse than showing none. They are still present on the record for
            // the raw-data view.
        },
    };
}
