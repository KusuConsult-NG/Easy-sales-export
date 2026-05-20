/**
 * Compatibility Layer: Re-export all payment handlers from the new Centralized Payments Infrastructure Service.
 * This ensures that existing imports do not break and compile perfectly.
 */

export {
    processMarketplaceOrder,
    processExportInvestment,
    processCooperativeRegistration,
    processAcademyRegistration,
    processFarmNationRegistration,
    processWaveRegistration
} from "@/infrastructure/payments/service";
