/**
 * The export onboarding submission, shaped the way the server stores it.
 *
 *   #773 THE FORM AND THE SERVER VALIDATED TWO DIFFERENT SHAPES, SO NOTHING
 *        THE MEMBER TYPED SURVIVED — AND MOST SUBMISSIONS DID NOT EVEN LAND.
 *
 *   Reported by the owner: "details added to the form and some are missing in
 *   the process of submission, why?"
 *
 *   Measured against the real action, with EXACTLY the payload
 *   ExportOnboardingClient builds:
 *
 *       submitExportOnboardingAction(null, <what the client sends>)
 *         → { success: false,
 *             error: "Invalid input: expected string, received undefined" }
 *         → 0 application rows written
 *
 *   Eight required fields arrive undefined, because the two schemas disagree
 *   about what each bag holds:
 *
 *       profile.firstName, lastName, phone, state, lga, address
 *       terms.termsAccepted, privacyAccepted
 *
 *   The client's `profile` bag is the INVESTMENT step — minInvestment,
 *   maxInvestment, investmentGoals, riskTolerance. The server's `profile` is
 *   the IDENTITY — name, phone, state, LGA, address. The identity fields the
 *   member typed are in `kycData`, which the server's schema does not declare
 *   them on, and Zod strips unknown keys.
 *
 *   SO EXPORT ONBOARDING COULD NOT BE COMPLETED. The member fills every step,
 *   passes the client's own Zod guard, presses submit, and is told "Invalid
 *   input: expected string, received undefined" — a message naming no field.
 *   Resubmission had the identical break, and worse: it passes `fields.kyc`,
 *   which is `{ kycData, documents }`, where the schema expects the kycData
 *   itself.
 *
 * ── AND WHEN IT DID PARSE, NINE FIELDS WERE THROWN AWAY ─────────────────────
 *
 *   Given a server-shaped profile, the same measurement shows what `kycData`
 *   keeps:
 *
 *       sent     firstName, lastName, otherNames, dateOfBirth, phoneNumber,
 *                address, city, state, idType, nin, bvn, ninVerified, bvnVerified
 *       kept     nin, bvn, ninVerified, bvnVerified
 *       dropped  the other nine
 *
 *   Every one of the nine is REQUIRED by KYCVerificationStep before it lets
 *   the member past. #349 recorded this exact mechanism on this exact schema —
 *   "Zod strips unknown keys, so the number and its verification were dropped
 *   between the step and the record — collected, validated, and never stored"
 *   — and fixed it for the voter's card alone.
 *
 *   It is also the likeliest source of the owner's older report, "when admin
 *   views members most times they see empty fields and missing informations":
 *   the admin Users list reads firstName, lastName, phone, state and address,
 *   and export onboarding never delivered any of them.
 *
 * ── WHY A MAPPER AND NOT AN EDIT AT EACH END ────────────────────────────────
 *
 *   Because an edit at each end is what produced this. Two schemas describing
 *   one submission drifted until they shared almost no keys, and each was
 *   internally consistent, so neither side's tests noticed. This codebase has
 *   settled the repair more than once — #501 put it plainly, "THE FIELD, NOT
 *   THE CHECK, IS THE UNIT" — and the field here is the whole payload.
 *
 *   One function builds it, both the submit and the resubmit paths call it,
 *   and its output is parsed by the server's own schema in the test, so the
 *   two cannot disagree again without a failure.
 *
 * ── THE ONE JUDGEMENT CALL, STATED ──────────────────────────────────────────
 *
 *   The server wants `lga`; the KYC step asks for CITY and never for an LGA
 *   (see KYCData — there is no such field to collect). The city is the
 *   member's own answer about their locality, so it is what `lga` is filled
 *   from, and `city` is ALSO kept on the kyc record so the original answer is
 *   not rewritten into something it was not asked for.
 */

/** What the wizard holds, loosely — steps write into it independently. */
export interface ExportWizardData {
    profile?: {
        minInvestment?: unknown;
        maxInvestment?: unknown;
        investmentGoals?: unknown;
        riskTolerance?: unknown;
    } | null;
    kyc?: {
        kycData?: Record<string, unknown> | null;
        documents?: Record<string, unknown> | null;
    } | null;
    bank?: Record<string, unknown> | null;
    terms?: Record<string, unknown> | null;
}

/** The four bags the server's exportOnboardingSchema parses, plus investment. */
export interface ExportOnboardingPayload {
    profile: Record<string, unknown>;
    kycData: Record<string, unknown>;
    bank: Record<string, unknown>;
    terms: Record<string, unknown>;
    investment: Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const bool = (v: unknown): boolean => v === true;

/**
 * True when the member accepted the terms, whichever wording the step used.
 *
 * The client has carried three spellings at once — the four-checkbox form, and
 * the two legacy booleans its own schema still accepts. All three mean the same
 * thing and the server asks one question, so they are resolved here rather than
 * at the server, where a legacy payload would simply be refused.
 */
export function termsAccepted(terms: Record<string, unknown> | null | undefined): boolean {
    const t = terms ?? {};
    const allFour = bool(t.acceptedInvestment) && bool(t.acceptedRisk)
        && bool(t.acceptedEscrow) && bool(t.acceptedPrivacy);
    return allFour || bool(t.accepted) || bool(t.agreedToTerms) || bool(t.termsAccepted);
}

/** True when the privacy notice was accepted — same reasoning as above. */
export function privacyAccepted(terms: Record<string, unknown> | null | undefined): boolean {
    const t = terms ?? {};
    return bool(t.acceptedPrivacy) || bool(t.privacyAccepted)
        //   The legacy single-checkbox forms covered both together.
        || bool(t.accepted) || bool(t.agreedToTerms);
}

/**
 * Build the submission the server stores, from what the wizard collected.
 *
 * Pure, so it can be asked directly with known inputs — and so the test can
 * feed its output straight into the server's own schema, which is the only
 * check that actually proves the two agree.
 */
export function toExportOnboardingPayload(
    wizard: ExportWizardData,
    sessionEmail?: string | null,
): ExportOnboardingPayload {
    const kyc = wizard.kyc?.kycData ?? {};
    const investment = wizard.profile ?? {};

    return {
        //   IDENTITY. The member typed these into the KYC step; the server
        //   stores them on the application and mirrors them to the user record,
        //   which is what the admin Users list reads.
        profile: {
            firstName: str(kyc.firstName),
            lastName: str(kyc.lastName),
            otherName: str(kyc.otherNames),
            phone: str(kyc.phoneNumber),
            email: str(sessionEmail),
            state: str(kyc.state),
            //   See the header: the step asks for a city and never an LGA.
            lga: str(kyc.city),
            address: str(kyc.address),
        },
        //   KYC. Everything the step collected that belongs to the identity
        //   record rather than the profile — nine of these were being dropped.
        kycData: {
            nin: str(kyc.nin),
            bvn: str(kyc.bvn),
            ninVerified: bool(kyc.ninVerified),
            bvnVerified: bool(kyc.bvnVerified),
            votersCard: str(kyc.votersCard),
            votersCardVerified: bool(kyc.votersCardVerified),
            dateOfBirth: str(kyc.dateOfBirth),
            otherNames: str(kyc.otherNames),
            city: str(kyc.city),
            idType: str(kyc.idType),
            idNumber: str(kyc.idNumber),
            cacNumber: str(kyc.cacNumber),
        },
        bank: {
            accountNumber: str(wizard.bank?.accountNumber),
            bankName: str(wizard.bank?.bankName),
            accountName: str(wizard.bank?.accountName),
            bankCode: str(wizard.bank?.bankCode),
        },
        terms: {
            termsAccepted: termsAccepted(wizard.terms),
            privacyAccepted: privacyAccepted(wizard.terms),
            acceptedAt: str(wizard.terms?.acceptedAt),
        },
        /*
         *   THE INVESTMENT STEP'S OWN ANSWERS, which had nowhere to go at all.
         *   The client put them in `profile`, the server's `profile` does not
         *   declare them, so Zod dropped every one — the first step of the
         *   wizard was stored nowhere.
         */
        investment: {
            minInvestment: Number(investment.minInvestment) || 0,
            maxInvestment: Number(investment.maxInvestment) || 0,
            investmentGoals: Array.isArray(investment.investmentGoals) ? investment.investmentGoals : [],
            riskTolerance: str(investment.riskTolerance),
        },
    };
}
