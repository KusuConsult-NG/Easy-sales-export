
import { CanonicalUserProfile, LATEST_SCHEMA_VERSION } from "./schemas";
//   #754 — the placeholder rule and the string coercion, shared with
//   _users.ts rather than written out a second time here.
import { realNameOrBlank, asDisplayString } from "./placeholder-names";

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

    /**
     * 2. Resolve Bank Details (Aggressive fallback)
     *
     * The user document's own legacy spellings — bankAccountNumber,
     * bankAccountName and the bankAccount sub-object — are in the chain now.
     * They were not, and they are what admin/_legacy.ts and
     * wave/_wv_applications.ts write: `bankAccountNumber` flat on the user, no
     * `bankDetails` block at all for a member onboarded before that block
     * existed. Every screen built on this resolver therefore showed a blank
     * destination account for exactly the bulk-imported members whose payouts
     * are made by hand.
     *
     * Appended, not prepended, so nobody who already resolves changes.
     */
    const bankDetails = {
        bankName:      cleanVal(uData.bankDetails?.bankName)      || cleanVal(wData?.bankName)      || cleanVal(cData?.bankDetails?.bankName)      || cleanVal(sData?.bankAccount?.bankName)      || cleanVal(uData.bankName)      || cleanVal(uData.bankAccount?.bankName)      || "",
        accountNumber: cleanVal(uData.bankDetails?.accountNumber) || cleanVal(wData?.accountNumber) || cleanVal(cData?.bankDetails?.accountNumber) || cleanVal(sData?.bankAccount?.accountNumber) || cleanVal(uData.accountNumber) || cleanVal(uData.bankAccountNumber) || cleanVal(uData.bankAccount?.accountNumber) || "",
        accountName:   cleanVal(uData.bankDetails?.accountName)   || cleanVal(cData?.bankDetails?.accountName)   || cleanVal(sData?.bankAccount?.accountName)   || cleanVal(uData.bankAccountName) || cleanVal(uData.bankAccount?.accountName) || cleanVal(uData.fullName) || fullName || "",
        bankCode:      cleanVal(uData.bankDetails?.bankCode)      || cleanVal(cData?.bankDetails?.bankCode)      || cleanVal(sData?.bankAccount?.bankCode)      || cleanVal(uData.bankCode) || cleanVal(uData.bankAccount?.bankCode) || ""
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

    /**
     *   #754 THIS RESOLVER NEVER LOOKED AT serviceRegistrations, AND THAT IS
     *        WHERE MOST MEMBERS' DETAILS ACTUALLY LIVE.
     *
     *   Reported by the owner: "when admin views members most times they see
     *   empty fields and missing informations". Measured rather than guessed —
     *   given a user document whose details sit in a module registration, this
     *   function returned:
     *
     *       name: ""  phone: ""  state: ""  nin: ""  bankName: ""
     *
     *   Everything. It read only `uData.verificationProfile`, and a member
     *   who joined through the cooperative, WAVE or marketplace flow has their
     *   firstName, phone, state, NIN and bank details under
     *   `serviceRegistrations.<module>.profile` instead.
     *
     *   `_users.ts` — which powers /admin/users — walks every module
     *   registration for exactly these fields and has done for a long time. So
     *   the SAME member renders fully on /admin/users and blank on the
     *   cooperative members list, the cooperative money screen, both withdrawal
     *   queues and the WAVE certificate, because those five call THIS function.
     *   Two resolvers for one question, and the thin one serves five of the six
     *   screens.
     *
     *   Harvested in the same shape `_users.ts` uses — `reg.profile || reg`,
     *   since some generations nest the profile and some do not — and folded in
     *   as ONE more source at the END of every chain, so a member who resolves
     *   today resolves identically.
     */
    const moduleProfiles: any[] = Object.values(uData?.serviceRegistrations ?? {})
        .map((reg: any) => reg?.profile || reg)
        .filter((p: any) => p && typeof p === "object");

    /** The first module registration that has a real value for `pick`. */
    const fromModules = (pick: (p: any) => unknown): any => {
        for (const p of moduleProfiles) {
            const v = pick(p);
            if (v !== undefined && v !== null && v !== "") return v;
        }
        return undefined;
    };

    /**
     * 1. BANK DETAILS (SSOT Priority)
     *
     * `bankAccountNumber` / `bankAccountName` / `bankAccount.*` on the USER
     * document are in the chain now — see the same note in normalizeAggressive
     * above. They are what admin/_legacy.ts writes for a bulk-imported member
     * and what wave/_wv_applications.ts writes alongside the canonical block,
     * and this resolver read neither, so the WAVE withdrawal queue, the
     * cooperative money screen and the admin withdrawal queue all showed a
     * blank destination account for those members.
     *
     * Appended, so a member who already resolves is unaffected.
     */
    const bankDetails = {
        bankName:      profile?.bankDetails?.bankName      || uData?.bankDetails?.bankName      || uData?.bankName      || appData?.bankName      || appData?.bankAccount?.bankName      || uData?.bankAccount?.bankName      || fromModules((p) => p.bankDetails?.bankName || p.bankName) || "",
        accountNumber: profile?.bankDetails?.accountNumber || uData?.bankDetails?.accountNumber || uData?.accountNumber || appData?.accountNumber || appData?.bankAccount?.accountNumber || uData?.bankAccountNumber || uData?.bankAccount?.accountNumber || fromModules((p) => p.bankDetails?.accountNumber || p.accountNumber || p.bankAccountNumber) || "",
        accountName:   profile?.bankDetails?.accountName   || uData?.bankDetails?.accountName   || uData?.accountName   || appData?.accountName   || appData?.bankAccount?.accountName   || uData?.bankAccountName || uData?.bankAccount?.accountName || fromModules((p) => p.bankDetails?.accountName || p.accountName) || realNameOrBlank(uData?.fullName) || "",
        bankCode:      profile?.bankDetails?.bankCode      || uData?.bankDetails?.bankCode      || uData?.bankCode      || appData?.bankCode      || appData?.bankAccount?.bankCode      || uData?.bankAccount?.bankCode      || fromModules((p) => p.bankDetails?.bankCode || p.bankCode) || "",
    };

    // 2. ADDRESS (SSOT Priority)
    /*
     *   #754 — `asDisplayString`, and the module profiles appended.
     *
     *   TWO defects here, and only one of them is about missing data.
     *
     *   Some schema generations store `state` as `{ name, code }` rather than a
     *   string. `_users.ts` unwraps that explicitly and says why — "preventing
     *   React objects-as-children crashes" — and this resolver returned the
     *   object as-is. Any screen rendering `{address.state}` from here was one
     *   legacy row away from a blank page, which is a louder failure than the
     *   missing field it sits beside.
     */
    const address = {
        street: asDisplayString(profile?.address?.street || uData?.address?.street || uData?.residentialAddress || uData?.street || appData?.residentialAddress || appData?.address?.street || appData?.address || fromModules((p) => p.address?.street || p.residentialAddress || p.street) || ""),
        state:  asDisplayString(profile?.address?.state  || uData?.address?.state  || uData?.state || uData?.stateOfOrigin || appData?.state || appData?.stateOfOrigin || appData?.stateOfResidence || appData?.residentialState || appData?.address?.state || fromModules((p) => p.address?.state || p.state || p.stateOfOrigin) || ""),
        lga:    asDisplayString(profile?.address?.lga    || uData?.address?.lga    || uData?.lga   || appData?.lga   || appData?.lgaOfOrigin   || appData?.lgaOfResidence   || appData?.residentialLga   || appData?.address?.lga   || fromModules((p) => p.address?.lga || p.lga || p.lgaOfOrigin) || ""),
    };

    // 3. IDENTITY
    /**
     *   #751 THE APPLICATION ROW'S OWN NAME PARTS WERE NEVER CONSULTED.
     *
     *   The chain fell back to `appData.fullName || appData.name` and stopped.
     *   Every writer of a cooperative member row records firstName and lastName
     *   — _coop_registration and the legacy import both do — and a row that
     *   carries those WITHOUT a fullName rendered a blank name, with the answer
     *   sitting in the next two fields along.
     *
     *   It matters because of who it happens to: this audit measured 48
     *   cooperative_members references with no matching profile. For those the
     *   user document is `{}`, so `appData` is the only source there is, and a
     *   gap in this chain is the difference between a name and an empty cell on
     *   the admin's screen.
     *
     *   Built by the same rule the writers use — first, other, last, blanks
     *   dropped — rather than assuming two parts.
     *
     *   STRICTLY ADDITIVE. The user document's half keeps its exact old
     *   behaviour — including requiring BOTH firstName and lastName before it
     *   will build a name — because relaxing that would let a profile carrying
     *   only a first name beat a complete name on the application row. The new
     *   parts go on the END of the chain, so a row that resolved before
     *   resolves identically now.
     */
    const joined = (...parts: unknown[]) =>
        parts.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean).join(" ");

    /*
     *   #754 — EVERY LINK IS NOW FILTERED THROUGH THE PLACEHOLDER RULE, and a
     *   module registration is consulted at the end.
     *
     *   Measured before changing anything: `extractCanonicalUser({ fullName:
     *   "User" })` returned the name "User". That string is not a name — the
     *   ghost-account auto-repair wrote it before April 2026 — and /admin/users
     *   has rejected it for exactly that reason all along, falling through so
     *   the table shows something real. Five other screens, all on this
     *   resolver, printed it as a person.
     *
     *   `realNameOrBlank` turns each placeholder into "" so the chain CONTINUES
     *   past it rather than stopping on a stand-in. A member whose user
     *   document says "Unknown" and whose cooperative row says "Amaka Obi" now
     *   reads as Amaka Obi; before, "Unknown" won because it was first and
     *   truthy.
     */
    const name = realNameOrBlank(uData?.fullName)
        || realNameOrBlank(uData?.name)
        || (uData?.firstName && uData?.lastName
            ? joined(uData.firstName, uData.otherName, uData.lastName)
            : "")
        || realNameOrBlank(appData?.fullName)
        || realNameOrBlank(appData?.name)
        || joined(appData?.firstName, appData?.otherName, appData?.lastName)
        //   The module registrations, last, so nothing that resolved before
        //   resolves differently now.
        || realNameOrBlank(fromModules((p) => p.fullName || p.name))
        || joined(
            fromModules((p) => p.firstName),
            fromModules((p) => p.otherName),
            fromModules((p) => p.lastName || p.surname),
        )
        || "";

    return {
        name,
        email: uData?.email || appData?.email || appData?.userEmail || fromModules((p) => p.email) || "",
        phone: uData?.phone || uData?.phoneNumber || uData?.kyc?.phoneNumber || uData?.kyc?.phone || appData?.phone || appData?.phoneNumber || appData?.kyc?.phoneNumber || appData?.kyc?.phone || fromModules((p) => p.phone || p.phoneNumber || p.kyc?.phoneNumber) || "",
        dateOfBirth: uData?.dateOfBirth || appData?.dateOfBirth || appData?.personalInfo?.dateOfBirth || fromModules((p) => p.dateOfBirth || p.personalInfo?.dateOfBirth) || "",
        gender: uData?.gender || appData?.gender || appData?.personalInfo?.gender || appData?.profile?.gender || profile?.gender || fromModules((p) => p.gender || p.personalInfo?.gender) || "",
        bankDetails,
        address,
        /*
         *   #754 — `kyc.nin` AND `kyc.bvn` WERE NOT IN THESE CHAINS.
         *
         *   Measured: `extractCanonicalUser({ kyc: { nin: "...", bvn: "..." } })`
         *   returned "" for both. `_users.ts` reads `data.kyc?.nin || data.nin`
         *   and has done all along — the nested spelling is what the KYC flow
         *   writes — so a member's NIN showed on /admin/users and was blank on
         *   every screen built on this resolver.
         */
        nin: profile?.nin || uData?.kyc?.nin || uData?.nin || appData?.kyc?.nin || appData?.nin || fromModules((p) => p.kyc?.nin || p.nin) || "",
        bvn: profile?.bvn || uData?.kyc?.bvn || uData?.bvn || appData?.kyc?.bvn || appData?.bvn || fromModules((p) => p.kyc?.bvn || p.bvn) || "",
    };
}

