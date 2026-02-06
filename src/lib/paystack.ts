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

/**
 * Generate a unique payment reference with prefix (Server-side)
 */
export function generateReference(prefix: string = "PAY"): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

/**
 * Verify Paystack payment (Server-side)
 */
export async function verifyPaystackPayment(reference: string) {
    try {
        const response = await fetch(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                },
            }
        );

        const data = await response.json();

        if (data.status && data.data.status === "success") {
            return {
                success: true,
                amount: data.data.amount / 100, // Convert from kobo to naira
                metadata: data.data.metadata,
                paidAt: data.data.paid_at,
            };
        }

        return {
            success: false,
            error: data.message || "Payment verification failed",
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message || "Verification failed",
        };
    }
}

