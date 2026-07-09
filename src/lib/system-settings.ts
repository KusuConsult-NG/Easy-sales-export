
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { unstable_cache } from "next/cache";

export interface PlatformFees {
    baseDeliveryFee: number;
    additionalItemFee: number;
    platformFeePercentage: number;
    minOrderAmount: number;
    maxOrderAmount: number;
}

export interface ExchangeRates {
    usdToNgn: number;
}

export interface WaveSettings {
    commissionRate: number;
}

const DEFAULT_FEES: PlatformFees = {
    baseDeliveryFee: 2500,
    additionalItemFee: 500,
    platformFeePercentage: 0.05,
    minOrderAmount: 500,
    maxOrderAmount: 10000000
};

const DEFAULT_EXCHANGE_RATES: ExchangeRates = {
    usdToNgn: 1650,
};

const DEFAULT_WAVE_SETTINGS: WaveSettings = {
    commissionRate: 0.05,
};

export const getPlatformFees = unstable_cache(
    async (): Promise<PlatformFees> => {
        try {
            const doc = await db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc("platform_fees").get();
            if (doc.exists) {
                return { ...DEFAULT_FEES, ...doc.data() } as PlatformFees;
            }
            return DEFAULT_FEES;
        } catch (error) {
            console.error("Failed to fetch platform fees:", error);
            return DEFAULT_FEES;
        }
    },
    ["platform-fees"],
    { revalidate: 3600, tags: ["platform-fees"] }
);

export const getExchangeRates = unstable_cache(
    async (): Promise<ExchangeRates> => {
        try {
            const doc = await db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc("exchange_rates").get();
            if (doc.exists) {
                return { ...DEFAULT_EXCHANGE_RATES, ...doc.data() } as ExchangeRates;
            }
            return DEFAULT_EXCHANGE_RATES;
        } catch (error) {
            console.error("Failed to fetch exchange rates:", error);
            return DEFAULT_EXCHANGE_RATES;
        }
    },
    ["exchange-rates"],
    { revalidate: 3600, tags: ["exchange-rates"] }
);

export const getWaveSettings = unstable_cache(
    async (): Promise<WaveSettings> => {
        try {
            const doc = await db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc("wave_settings").get();
            if (doc.exists) {
                return { ...DEFAULT_WAVE_SETTINGS, ...doc.data() } as WaveSettings;
            }
            return DEFAULT_WAVE_SETTINGS;
        } catch (error) {
            console.error("Failed to fetch wave settings:", error);
            return DEFAULT_WAVE_SETTINGS;
        }
    },
    ["wave-settings"],
    { revalidate: 3600, tags: ["wave-settings"] }
);
