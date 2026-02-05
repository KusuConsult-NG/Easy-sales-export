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
