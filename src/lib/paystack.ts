"use client";

import { useEffect } from "react";

declare global {
    interface Window {
        PaystackPop?: any;
    }
}

export interface PaystackConfig {
    reference: string;
    email: string;
    amount: number; // in kobo
    publicKey: string;
    onSuccess: (reference: any) => void;
    onClose: () => void;
    currency?: string;
    metadata?: Record<string, any>;
}

/**
 * Paystack Integration Hook
 */
export function usePaystack(config: PaystackConfig | null) {
    useEffect(() => {
        // Load Paystack script
        if (!document.querySelector('script[src*="paystack"]')) {
            const script = document.createElement("script");
            script.src = "https://js.paystack.co/v1/inline.js";
            script.async = true;
            document.body.appendChild(script);
        }
    }, []);

    const initializePayment = () => {
        if (!config) {
            console.error("Paystack config is required");
            return;
        }

        if (!window.PaystackPop) {
            console.error("Paystack script not loaded");
            return;
        }

        const handler = window.PaystackPop.setup({
            key: config.publicKey,
            email: config.email,
            amount: config.amount,
            ref: config.reference,
            currency: config.currency || "NGN",
            channels: ["bank_transfer"],
            metadata: config.metadata,
            onClose: config.onClose,
            callback: (response: any) => {
                config.onSuccess(response);
            },
        });

        handler.openIframe();
    };

    return { initializePayment };
}

/**
 * Generate Paystack payment reference
 */
export function generatePaymentReference(): string {
    return `PSX_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Convert Naira to Kobo (Paystack uses kobo)
 */
export function nairaToKobo(naira: number): number {
    return Math.round(naira * 100);
}

/**
 * Convert Kobo to Naira
 */
export function koboToNaira(kobo: number): number {
    return kobo / 100;
}

/**
 * Generate a unique payment reference with prefix (Server-side)
 */
export function generateReference(prefix: string = "PAY"): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

/*
 * ── #727 A SECOND verifyPaystackPayment LIVED HERE, AND IT WAS THE WEAK ONE ──
 *
 *   This file exported a function named `verifyPaystackPayment`, marked
 *   "(Server-side)", in a module whose first line is "use client". The platform
 *   already has a function of that exact name in lib/paystack-SERVER.ts, and
 *   the two differed in every way that matters:
 *
 *     paystack-server.ts   retries transient failures, THROWS when the secret
 *                          is missing, and returns Paystack's own response
 *                          shape. It fails closed, and the block comment above
 *                          it records why at length — it is the function a
 *                          fabricated-reference bypass was removed from.
 *
 *     this one             no retry, and every failure — including a missing
 *                          PAYSTACK_SECRET_KEY — came back as an ordinary
 *                          `{ success: false }`. A caller that treated a
 *                          falsy result as "payment not successful" rather
 *                          than "verification did not happen" would be making
 *                          #714's mistake on a money path: a lookup that
 *                          FAILED reported as an answer.
 *
 *   NOTHING IMPORTED IT. The only import of this module anywhere in the
 *   repository is `generateReference`, in api/cooperatives/register. So this
 *   was not a live defect — it was a loaded trap, one character of import path
 *   away from the real one, offered by the same autocomplete.
 *
 *   REMOVED RATHER THAN HARDENED, on #706's precedent for the fabricated-
 *   reference block in the same family: "REMOVED RATHER THAN NARROWED, because
 *   nothing used it." A second implementation of the platform's most
 *   security-critical function earns its keep only by being used, and this one
 *   was not. There is now exactly one, and a ratchet says so.
 *
 *   `"use client"` is left in place: this module still exports the usePaystack
 *   hook. What is gone is the server-secret read inside it.
 */

