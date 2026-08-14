
/**
 * Public Entry Point for Marketplace Server Actions
 *
 * This barrel file exposes the unified API for all Marketplace domains,
 * routing requests to underscore-prefixed private modules.
 */

export * from "./_mp_onboarding";
export * from "./_mp_seller_verification";
export * from "./_mp_products";
export * from "./_mp_catalog";
export * from "./_mp_seller_dashboard";
export * from "./_mp_buyer_dashboard";
export * from "./_buyer";
export * from "./_payment_orders";
export * from "./_payment_verify";
export * from "./_quotes";
export * from "./_reviews";
// Escrow types moved to a plain module when _escrow.ts was split; re-exported
// here because `export * from "./_escrow"` used to carry them.
export type { EscrowTransaction, Dispute, Message } from "@/lib/types/marketplace-escrow";

export * from "./_escrow_lifecycle";
export * from "./_escrow_disputes";
export * from "./_escrow_messages";
export * from "./_escrow_actions";
