import { z } from "zod";
import { strictNameSchema, strictEmailSchema, strictPhoneSchema } from "@/lib/schemas";
import { requiredNationalIdField, optionalVotersCardField } from "@/lib/kyc-validators";

/**
 * WHICH FIELD, AND WHICH SECTION — so a refused WAVE application says so.
 *
 *   #905 SEVEN SECTIONS, AND THEN "Too small: expected number to be >=18".
 *
 *   Found auditing the files no test had named: the three WAVE application
 *   steps were on that list. Both doors — submitMultiStepWaveApplicationAction
 *   and resubmitWaveApplicationAction — end a failed parse the same way:
 *
 *       return { success: false, error: validation.error.issues[0]?.message
 *                                       || "Validation failed", data: null };
 *
 *   `issues[0].path` is right there, holding the field's name, and it is
 *   thrown away. So for every field whose schema entry carries no custom
 *   message, the applicant is shown Zod's type error and nothing else.
 *   MEASURED against this exact schema rather than reasoned about:
 *
 *       age                     "Too small: expected number to be >=18"
 *       involvedInAgriculture   "Invalid input: expected boolean, received
 *                                undefined"
 *       maritalStatus           "Invalid option: expected one of
 *                                "single"|"married"|"widowed"|"divorced"|"""
 *       valueChainAreas         "Invalid input: expected array, received
 *                                undefined"
 *       declarationAccepted     "Invalid input: expected boolean, received
 *                                undefined"
 *
 *   Fourteen of the schema's required fields carry no message of their own.
 *   The applicant has filled seven sections by then — on the largest programme
 *   this platform runs, 20,247 applications by the count in _wv_applications —
 *   and is told a type error with no field name, no section, and nowhere to go.
 *
 *   #855's rule, in its own words: "a submit that fails late looks like the
 *   platform breaking rather than a form telling her something."
 *
 * ── AND THE FORM'S OWN GUARD CHECKED THREE OF THIRTY ────────────────────────
 *
 *   WaveApplicationClient has a hand-written pre-submission guard, which is the
 *   right idea — it catches the localStorage-restored draft before the server
 *   sees it, and sends the applicant back to the step. It checks surname,
 *   firstName, phone, dateOfBirth, stateOfOrigin, stateOfResidence,
 *   maritalStatus, nextOfKinName, nextOfKinPhone, bankName and accountNumber.
 *
 *   The schema requires those AND: otherNames' siblings lgaOfOrigin and
 *   lgaOfResidence, residentialAddress, nextOfKinRelationship, nin, bvn,
 *   currentOccupation, age, and eleven booleans and arrays. A draft missing any
 *   of them passes the form's guard and fails at the server, which is where the
 *   unreadable message above is produced.
 *
 *   So the two halves are one table now, in the shape lib/land-soil and
 *   lib/lease-term take: the server turns a Zod path into a sentence, the form
 *   checks the same list before it submits and jumps to the step that holds the
 *   field. Neither can grow a field the other does not know about without this
 *   file changing.
 */

/** The steps of the application wizard, in order — WaveApplicationClient's own STEPS. */
export const WAVE_STEPS = [
    "Personal Details",
    "Civic Status",
    "Socio-Economic",
    "Agricultural Interest",
    "Financial Details",
    "Training & Support",
    "Review",
] as const;

export interface WaveFieldPlace {
    /** What the form calls this field, in the applicant's words. */
    label: string;
    /** The index into WAVE_STEPS — where the form sends her to fix it. */
    step: number;
}

/**
 * Every field the schema in _wv_applications can refuse, and where it lives.
 *
 * The SECTION LETTERS are the schema's own comments (SECTION A … SECTION G) and
 * the step indices are the wizard's. They agree today and a test says so, which
 * is the point of writing both down in one place.
 */
export const WAVE_FIELD_PLACES: Record<string, WaveFieldPlace> = {
    // SECTION A — Personal Identification
    surname: { label: "Surname", step: 0 },
    firstName: { label: "First name", step: 0 },
    otherNames: { label: "Other names", step: 0 },
    dateOfBirth: { label: "Date of birth", step: 0 },
    age: { label: "Age", step: 0 },
    phone: { label: "Phone number", step: 0 },
    alternativePhone: { label: "Alternative phone number", step: 0 },
    email: { label: "Email address", step: 0 },
    residentialAddress: { label: "Residential address", step: 0 },
    stateOfOrigin: { label: "State of origin", step: 0 },
    lgaOfOrigin: { label: "LGA of origin", step: 0 },
    stateOfResidence: { label: "State of residence", step: 0 },
    lgaOfResidence: { label: "LGA of residence", step: 0 },
    maritalStatus: { label: "Marital status", step: 0 },
    nextOfKinName: { label: "Next of kin's name", step: 0 },
    nextOfKinPhone: { label: "Next of kin's phone number", step: 0 },
    nextOfKinRelationship: { label: "Relationship to next of kin", step: 0 },

    // SECTION B — National Identity & Civic Status
    nin: { label: "NIN", step: 1 },
    votersCardNumber: { label: "Voter's card number", step: 1 },
    pollingUnit: { label: "Polling unit", step: 1 },
    ward: { label: "Ward", step: 1 },
    yearOfVoterRegistration: { label: "Year of voter registration", step: 1 },
    votedInLastElection: { label: "Whether you voted in the last election", step: 1 },

    // SECTION C — Socio-Economic Profile
    highestEducation: { label: "Highest level of education", step: 2 },
    currentOccupation: { label: "Current occupation", step: 2 },
    averageMonthlyIncome: { label: "Average monthly income", step: 2 },
    involvedInAgriculture: { label: "Whether you are involved in agriculture", step: 2 },
    agricultureTypes: { label: "Your agricultural activities", step: 2 },

    // SECTION D — Agricultural Interest & Value Chain
    valueChainAreas: { label: "Value chain areas of interest", step: 3 },
    preferredCommodities: { label: "Preferred commodities", step: 3 },
    preferredCommodityOther: { label: "Other preferred commodity", step: 3 },
    hasAccessToFarmland: { label: "Whether you have access to farmland", step: 3 },
    farmlandHectares: { label: "Farmland size in hectares", step: 3 },
    needsFarmlandAccess: { label: "Whether you need access to farmland", step: 3 },

    // SECTION E — Financial & Cooperative Details
    hasBankAccount: { label: "Whether you have a bank account", step: 4 },
    bankName: { label: "Bank name", step: 4 },
    accountNumber: { label: "Account number", step: 4 },
    bvn: { label: "BVN", step: 4 },
    isMemberOfCooperative: { label: "Whether you belong to a cooperative", step: 4 },
    cooperativeName: { label: "Cooperative name", step: 4 },
    willingToJoinCooperative: { label: "Whether you are willing to join a cooperative", step: 4 },

    // SECTION F — Training, Support & Commitment
    supportNeeded: { label: "The support you need", step: 5 },
    willingToUndergoTraining: { label: "Whether you are willing to undergo training", step: 5 },
    willingToComplyWithStandards: { label: "Whether you are willing to comply with standards", step: 5 },
    willingToParticipateInME: { label: "Whether you are willing to take part in monitoring", step: 5 },

    // SECTION G — Declaration & Consent
    declarationAccepted: { label: "The declaration", step: 6 },
    consentGiven: { label: "Your consent", step: 6 },
};

/**
 * Whether a message already names the field it is about.
 *
 * The schema gives about half its entries a written message — "Residential
 * address is required", "NIN must be exactly 11 digits" — and those read as
 * sentences already. Prefixing them would produce "Residential address —
 * Residential address is required". Zod's own type errors are the ones that
 * say nothing, and they are recognisable: they are the only messages that do
 * not mention the field.
 */
function messageNamesTheField(message: string, label: string): boolean {
    const m = message.toLowerCase();
    //   The first word of the label is enough — "Residential address is
    //   required" for label "Residential address", "NIN is required" for "NIN".
    const first = label.toLowerCase().split(" ")[0];
    return first.length > 2 && m.includes(first);
}

export interface WaveFieldIssue {
    /** Zod's `issue.path` — the first entry is the field. */
    path?: ReadonlyArray<PropertyKey> | null;
    message?: string | null;
}

/**
 * The sentence an applicant is shown when her application is refused.
 *
 * Always names a field and a step when the path identifies one, because the
 * whole finding is that it did not. Falls back to the bare message rather than
 * inventing a field: an issue with no path is a schema-level refusal, and
 * guessing which box it came from would send her to the wrong section.
 */
export function waveFieldRefusal(issue: WaveFieldIssue | null | undefined): string {
    const message = String(issue?.message ?? "").trim() || "Validation failed";
    const key = String(issue?.path?.[0] ?? "");
    const place = key ? WAVE_FIELD_PLACES[key] : undefined;

    if (!place) return message;

    const where = `Section ${String.fromCharCode(65 + Math.min(place.step, 6))} — ${WAVE_STEPS[place.step]}`;

    return messageNamesTheField(message, place.label)
        ? `${message} (${where})`
        : `${place.label}: ${message} (${where})`;
}

/**
 * The step the applicant should be sent back to, or null when the issue does
 * not identify one.
 */
export function waveFieldStep(issue: WaveFieldIssue | null | undefined): number | null {
    const key = String(issue?.path?.[0] ?? "");
    return key && WAVE_FIELD_PLACES[key] ? WAVE_FIELD_PLACES[key].step : null;
}


/**
 * WHAT A WAVE APPLICATION MUST CONTAIN.
 *
 * Moved here from actions/wave/_wv_applications UNCHANGED, so the FORM can
 * read it too — see that file's note at the place it used to sit, and the
 * header above for why a guard covering a third of the fields was the defect.
 *
 * Exported, so the form parses the very thing the server will parse. There is
 * no second list to keep in step.
 */
export const waveApplicationSchema = z.object({ // SECTION A: Personal Identification
    surname: strictNameSchema,
    firstName: strictNameSchema,
    otherNames: strictNameSchema.optional().or(z.literal("")),
    dateOfBirth: z.string(),
    age: z.number().min(18).max(100),
    phone: strictPhoneSchema,
    alternativePhone: strictPhoneSchema.optional().or(z.literal("")),
    email: strictEmailSchema.optional().or(z.literal("")),
    residentialAddress: z.string().min(5, "Residential address is required"),
    stateOfOrigin: z.string().min(2, "State of origin is required"),
    lgaOfOrigin: z.string().min(2, "LGA of origin is required"),
    stateOfResidence: z.string().min(2, "State of residence is required"),
    lgaOfResidence: z.string().min(2, "LGA of residence is required"),
    maritalStatus: z.enum(["single", "married", "widowed", "divorced", ""]),
    nextOfKinName: z.string().min(2, "Next of kin name is required"),
    nextOfKinPhone: z.string().min(10, "Next of kin phone is required"),
    nextOfKinRelationship: z.string().min(2, "Relationship is required"),

    // SECTION B: National Identity & Civic Status
    //   #501 The WAVE application had no check on either field.
    //   #774 Mandatory, at the owner's instruction. Still no external check.
    nin: requiredNationalIdField('NIN'),
    //   #820 Optional, per the owner. A value that IS supplied is still checked.
    votersCardNumber: optionalVotersCardField(),
    pollingUnit: z.string().optional(),
    ward: z.string().optional(),
    yearOfVoterRegistration: z.string().optional(),
    votedInLastElection: z.boolean().optional(),

    // SECTION C: Socio-Economic Profile
    highestEducation: z.enum(["none", "primary", "secondary", "tertiary", "vocational", ""]),
    currentOccupation: z.string().min(2, "Current occupation is required"),
    averageMonthlyIncome: z.enum(["below_50k", "50k_100k", "100k_250k", "above_250k", ""]),
    involvedInAgriculture: z.boolean(),
    agricultureTypes: z.array(z.enum(["farming", "processing", "trading", "export", "logistics"])).optional(),

    // SECTION D: Agricultural Interest & Value Chain
    valueChainAreas: z.array(z.enum(["crop_production", "livestock", "processing_packaging", "aggregation_trading", "export_market"])),
    preferredCommodities: z.array(z.enum(["rice", "maize", "sesame", "soybeans", "ginger", "cassava", "vegetables", "other"])),
    preferredCommodityOther: z.string().optional(),
    hasAccessToFarmland: z.boolean(),
    farmlandHectares: z.number().optional(),
    needsFarmlandAccess: z.boolean().optional(),

    // SECTION E: Financial & Cooperative Details
    hasBankAccount: z.boolean().optional(),
    bankName: z.string().min(2, "Bank name is required"),
    accountNumber: z.string().min(10, "Valid 10-digit account number required"),
    bvn: requiredNationalIdField('BVN'),
    isMemberOfCooperative: z.boolean(),
    cooperativeName: z.string().optional(),
    willingToJoinCooperative: z.boolean(),

    // SECTION F: Training, Support & Commitment
    supportNeeded: z.array(z.enum(["training", "inputs", "mechanization", "finance", "market_access"])),
    willingToUndergoTraining: z.boolean(),
    willingToComplyWithStandards: z.boolean(),
    willingToParticipateInME: z.boolean(),

    // SECTION G: Declaration & Consent
    declarationAccepted: z.boolean(),
    consentGiven: z.boolean() });

export type WaveApplicationParsed = z.infer<typeof waveApplicationSchema>;
