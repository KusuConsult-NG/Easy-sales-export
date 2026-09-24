/**
 * What a marketplace application must carry before it may be filed.
 *
 *   THE OWNER: "Product and business status should be mandatory."
 *
 * ── WHY THIS IS A SHARED MODULE ─────────────────────────────────────────────
 *
 *   The wizard asked each question in three places and enforced it in one.
 *
 *       the step component   validate() on its own Continue button
 *       the submit guard     a Zod schema built inline in handleSubmit
 *       the server action    a handful of inline `if (!x) return` checks
 *
 *   The three did not agree, and the disagreement was not visible from any one
 *   of them:
 *
 *   ·  PRODUCT INTERESTS WAS ENFORCED NOWHERE BUT ITS OWN BUTTON. The submit
 *      guard's schema had no `buyerInterests`, no `sellerCategories` and no
 *      `productionCapacity` field — yet the error handler right below it maps
 *      exactly those three paths back to step 3. That branch could never be
 *      taken. Somebody meant to validate the step and the schema was never
 *      given the fields, so the dead mapping is the intent, written down.
 *
 *   ·  AND THE STEP'S OWN BUTTON IS SKIPPABLE. A restored draft jumps straight
 *      to the step it was saved at (`restoredStepIndex`, up to 6). Land on step
 *      4 and steps 2 and 3 never run their `validate()` at all.
 *
 *   ·  THE SERVER CHECKED `businessName` AND THE LOCATION AND NOTHING ELSE from
 *      those two steps. `businessType` and `phone` were read straight out of
 *      the FormData into the record. `sellerCategories` defaulted to `[]` and
 *      `sellerCategory` defaulted to `"retail"` — so an application that never
 *      answered either question was filed as a retail seller of nothing.
 *
 *   One rule, three callers, so a caller cannot have one without the others.
 *   This is the same shape as lib/seller-category: the vocabulary and the
 *   question asked of it live together.
 *
 * ── THE TWO NEW FIELDS ──────────────────────────────────────────────────────
 *
 *   `businessStatus` and `productStatus` are the owner's "status" fields. They
 *   are stored, not decorative: the Business Verification step already collects
 *   a CAC certificate and an RC number and marks both Optional for everyone,
 *   which leaves an admin reviewer unable to tell a business that HAS no
 *   registration from one that simply did not attach it. `businessStatus` is
 *   that missing answer. `productStatus` is the same question about the goods —
 *   a seller listing a harvest three months out is not the same applicant as
 *   one with stock in a warehouse today, and nothing on the application said
 *   which.
 */

import { isSellerCategory } from "@/lib/seller-category";

// ─────────────────────────────────────────────────────────────────────────────
//   THE VOCABULARY

/** Where the business stands as a registered entity. */
export const BUSINESS_STATUSES = ["registered", "in_progress", "unregistered"] as const;

export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export function isBusinessStatus(value: unknown): value is BusinessStatus {
    return typeof value === "string" && (BUSINESS_STATUSES as readonly string[]).includes(value);
}

export function businessStatusLabel(value: unknown): string {
    if (value === "registered") return "Registered (CAC / Cooperative)";
    if (value === "in_progress") return "Registration in progress";
    if (value === "unregistered") return "Not registered";
    return "";
}

/** Whether the goods exist yet, and when. */
export const PRODUCT_STATUSES = ["available", "seasonal", "pre_order"] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export function isProductStatus(value: unknown): value is ProductStatus {
    return typeof value === "string" && (PRODUCT_STATUSES as readonly string[]).includes(value);
}

export function productStatusLabel(value: unknown): string {
    if (value === "available") return "Available now";
    if (value === "seasonal") return "Seasonal";
    if (value === "pre_order") return "Pre-order / upcoming harvest";
    return "";
}

export const ACCOUNT_TYPES = ["buyer", "seller", "both"] as const;
export const BUSINESS_TYPES = ["individual", "cooperative", "company"] as const;

/**
 * What the Business Type row shows when nothing has been chosen.
 *
 *   THE DEFAULT IS THE FORM'S, NOT THE RULE'S, and that distinction cost a CI
 *   run. The step renders `businessType || "individual"`, so the screen shows
 *   Individual highlighted from the moment it opens — but `formData.businessType`
 *   stays undefined until somebody actually clicks a button. The Zod schema this
 *   rule replaced carried `.default("individual")`, which quietly papered over
 *   that; the rule does not, so a member who accepted the default was refused at
 *   submit with "Please select a business type" while the screen showed one
 *   selected. Nothing on it could be corrected, because nothing was wrong.
 *
 *   The rule STILL has no default — a request that reaches the server without a
 *   business type is refused, which is the check worth keeping. What changed is
 *   that the form now applies this constant everywhere it speaks: to draw the
 *   row, to validate the step, to build the submission, and to build the object
 *   the guard reads. One spelling, so the display and the payload cannot
 *   disagree again.
 */
export const DEFAULT_BUSINESS_TYPE: (typeof BUSINESS_TYPES)[number] = "individual";

// ─────────────────────────────────────────────────────────────────────────────
//   THE APPLICATION

export interface MarketplaceApplication {
    accountType?: unknown;
    sellerCategory?: unknown;

    businessName?: unknown;
    businessType?: unknown;
    businessStatus?: unknown;
    phone?: unknown;
    location?: { state?: unknown; lga?: unknown; address?: unknown } | null;

    buyerInterests?: unknown;
    sellerCategories?: unknown;
    productStatus?: unknown;

    termsAccepted?: unknown;

    bankAccount?: {
        bankName?: unknown;
        accountNumber?: unknown;
        accountName?: unknown;
    } | null;
}

/**
 * One missing answer.
 *
 *   `field` is the key the step components already use for their error
 *   messages, so a step can render these without a translation table. `step` is
 *   where the question is asked, so the submit guard can send somebody to it
 *   instead of guessing from an error path — which is what the dead mapping
 *   described above was trying to do by hand.
 */
export interface MissingField {
    field: string;
    step: number;
    message: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Is there a business here to describe?
 *
 *   THE OWNER: "in marketplace, the buyer can be an individual so the form for
 *   onboarding has to change… when a buyer select a company, business status
 *   should show; if its an individual then it can continue with the flow, but
 *   if its business it should take business information."
 *
 * Step 2 asked every applicant for a Business/Farm Name and a registration
 * status. Most buyers on this platform are people buying food — they have no
 * business name to give and no registration to declare — so the form demanded
 * two answers that do not exist and refused to continue without them. The only
 * way through was to invent a business.
 *
 * A SELLER ALWAYS DESCRIBES ONE, whatever they call themselves: they trade
 * under a name that appears on every listing they publish, they are reviewed
 * against a CAC certificate, and they are paid into an account. So this is not
 * "individual means no business questions" — it is "a buyer who is an
 * individual is a person, and a person has a name, not a trading name".
 *
 * An applicant who has not chosen a type yet is treated as describing one. The
 * businessType rule below refuses them anyway, and the safe direction for a
 * field that decides what a reviewer is shown is to ask rather than to skip.
 */
export function describesABusiness(data: MarketplaceApplication): boolean {
    const accountType = text(data.accountType);
    if (accountType === "seller" || accountType === "both") return true;
    return text(data.businessType) !== "individual";
}

const filled = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

/**
 * Every question this application has not answered, in the order it is asked.
 *
 *   Returns `[]` for a complete application. The FIRST entry is the earliest
 *   unanswered question, which is the one a member should be shown.
 */
export function missingApplicationFields(data: MarketplaceApplication): MissingField[] {
    const missing: MissingField[] = [];
    const miss = (field: string, step: number, message: string) => missing.push({ field, step, message });

    const accountType = text(data.accountType);
    const sells = accountType === "seller" || accountType === "both";
    const buys = accountType === "buyer" || accountType === "both";

    // ── Step 1 — account type ────────────────────────────────────────────────
    if (!accountType) {
        miss("accountType", 1, "Please select an account type.");
    } else if (!(ACCOUNT_TYPES as readonly string[]).includes(accountType)) {
        //   Distinct from the above on purpose: the wizard cannot produce this,
        //   so a request that reaches it did not come through the wizard.
        miss("accountType", 1, "That is not an account type we offer.");
    }
    if (sells && !isSellerCategory(data.sellerCategory)) {
        //   The default was `"retail"`, applied on the server to anybody who
        //   never answered — see lib/seller-category. A stored value that
        //   decides which broadcast audiences a seller appears in should not
        //   have a silent default.
        miss("sellerCategory", 1, "Select whether you sell wholesale, retail or both.");
    }

    // ── Step 2 — business profile ────────────────────────────────────────────
    //
    //   The business half of this step is asked only of an applicant who has a
    //   business — see describesABusiness. The contact half is asked of
    //   everybody: a buyer still has to be reachable and deliverable to.
    const hasBusiness = describesABusiness(data);

    if (hasBusiness && text(data.businessName).length < 2) {
        miss("businessName", 2, "Business/Farm name is required.");
    }
    if (!(BUSINESS_TYPES as readonly string[]).includes(text(data.businessType))) {
        miss("businessType", 2, "Please select a business type.");
    }
    if (hasBusiness && !isBusinessStatus(data.businessStatus)) {
        miss("businessStatus", 2, "Please select your business registration status.");
    }
    if (!text(data.phone)) {
        miss("phone", 2, "Phone number is required.");
    }

    const location = data.location ?? {};
    if (!text(location.state)) miss("state", 2, "State is required.");
    if (!text(location.lga)) miss("lga", 2, "LGA is required.");
    if (!text(location.address)) {
        miss("address", 2, hasBusiness ? "Business address is required." : "Delivery address is required.");
    }

    // ── Step 3 — product interests ───────────────────────────────────────────
    if (buys && !filled(data.buyerInterests)) {
        miss("buyerInterests", 3, "Select at least one product category you are interested in buying.");
    }
    if (sells && !filled(data.sellerCategories)) {
        miss("sellerCategories", 3, "Select at least one product category you will sell.");
    }
    if (sells && !isProductStatus(data.productStatus)) {
        miss("productStatus", 3, "Please select the status of the products you will sell.");
    }

    // ── Step 4 — terms ───────────────────────────────────────────────────────
    if (data.termsAccepted !== true) {
        miss("termsAccepted", 4, "You must accept the terms and conditions.");
    }

    // ── Step 6 — bank account, sellers only ──────────────────────────────────
    if (sells) {
        const bank = data.bankAccount ?? {};
        if (!text(bank.bankName)) miss("bankName", 6, "Bank name is required.");
        const accountNumber = text(bank.accountNumber);
        if (!accountNumber) miss("accountNumber", 6, "Account number is required.");
        else if (!/^\d{10}$/.test(accountNumber)) {
            //   NUBAN. The submit guard already required exactly ten digits and
            //   the server took any non-empty string, so the two doors onto the
            //   same payout account disagreed about what one looks like.
            miss("accountNumber", 6, "Account number must be exactly 10 digits.");
        }
        if (!text(bank.accountName)) miss("accountName", 6, "Account name is required.");
    }

    return missing;
}

/**
 * The missing answers for ONE step, keyed by field — the shape a step
 * component's `errors` state already has.
 *
 *   A step passes what it holds. Rules belonging to other steps are filtered
 *   out, so a step that does not know the account type cannot be tripped by a
 *   rule that depends on it.
 */
export function missingForStep(step: number, data: MarketplaceApplication): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const entry of missingApplicationFields(data)) {
        if (entry.step === step) errors[entry.field] = entry.message;
    }
    return errors;
}
