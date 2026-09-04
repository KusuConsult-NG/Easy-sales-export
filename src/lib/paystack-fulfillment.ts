/**
 * Compatibility Layer: Re-export all payment handlers from the new Centralized
 * Payments Infrastructure Service.
 *
 *   #367 THERE ARE NO EXISTING IMPORTS. The sentence this comment used to end
 *        with — "This ensures that existing imports do not break" — describes a
 *        migration that finished: every caller of these six handlers now
 *        imports them from @/infrastructure/payments/service directly, and
 *        nothing in src/ imports this file.
 *
 *        It is harmless and it is a THIRD name for the payment handlers, in a
 *        codebase where "two doors onto one operation, one of them unhardened"
 *        has been the finding roughly twenty times. Kept — deleting it would
 *        break any import outside this repository — and labelled, so the next
 *        person choosing an import path knows this one has no other users.
 */

export {
    processMarketplaceOrder,
    processExportInvestment,
    processCooperativeRegistration,
    processAcademyRegistration,
    processFarmNationRegistration,
    processWaveRegistration
} from "@/infrastructure/payments/service";
