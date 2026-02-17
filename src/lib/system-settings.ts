
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { unstable_cache } from "next/cache";

export interface PlatformFees {
    baseDeliveryFee: number;
    additionalItemFee: number;
    platformFeePercentage: number;
    minOrderAmount: number;
    maxOrderAmount: number;
}

const DEFAULT_FEES: PlatformFees = {
    baseDeliveryFee: 2500,
    additionalItemFee: 500,
    platformFeePercentage: 0.05,
    minOrderAmount: 500,
    maxOrderAmount: 10000000
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
