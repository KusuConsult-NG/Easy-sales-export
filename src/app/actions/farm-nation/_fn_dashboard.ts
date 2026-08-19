"use server";

import { isPurchasable } from "@/lib/land-listing-status";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import type { FarmNationDashboardStats, Property } from "@/lib/types/farm-nation-actions";

async function _getFarmNationDashboardStatsAction(): Promise<ActionResponse<FarmNationDashboardStats>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized', meta: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        // Fetch in parallel: user's listings + purchase transactions as buyer
        let listingsSnap, transactionsSnap, userDoc;
        try { 
            [listingsSnap, transactionsSnap, userDoc] = await Promise.all([
                db.collection(COLLECTIONS.LAND_LISTINGS)
                    .where('ownerId', '==', userId)
                    .orderBy('createdAt', 'desc')
                    .get(),
                db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                    .where('buyerId', '==', userId)
                    .orderBy('createdAt', 'desc')
                    .limit(10)
                    .get(),
                db.collection(COLLECTIONS.USERS).doc(userId).get(),
            ]);
        } catch (e: any) { 
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9 || e.message?.includes("index") || e.message?.includes("INDEX")) {
                logger.warn("Missing index for Dashboard Stats, falling back to sequential memory sort");
                // Fetch sequentially without sort
                const [lSnap, tSnap, uDoc] = await Promise.all([
                    db.collection(COLLECTIONS.LAND_LISTINGS).where('ownerId', '==', userId).get(),
                    db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).where('buyerId', '==', userId).limit(10).get(),
                    db.collection(COLLECTIONS.USERS).doc(userId).get(),
                ]);
                listingsSnap = lSnap;
                transactionsSnap = tSnap;
                userDoc = uDoc;
            } else { 
                throw e;
            }
        }

        const properties = serializeDocs<any>(listingsSnap.docs).map(d => ({ 
            id: d.id,
            size: Number(d.size) || 0,
            price: Number(d.price) || 0,
            status: d.status || 'draft',
            verified: d.status === 'verified',
            name: d.title || 'Unnamed Property',
            // BOTH location shapes. LAND_LISTINGS holds an object with
            // address/city/state/lga from the land module, and a plain STRING
            // with state and lga as siblings from farm-nation's own creation
            // path. Reading only the object shape left every farm-nation
            // listing showing a blank location and a blank state on its own
            // owner's dashboard.
            location: typeof d.location === 'string'
                ? d.location
                : (d.location?.address || d.location?.lga || ''),
            state: (typeof d.location === 'object' ? d.location?.state : undefined) || d.state || '',
            type: d.category || 'sale',
            createdAt: d.createdAt 
        }));
        // Sort in-memory by createdAt descending
        properties.sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
        });

        const transactions = serializeDocs<any>(transactionsSnap.docs).map(d => ({ 
            id: d.id,
            propertyName: d.propertyName || 'Unknown Property',
            propertyType: d.propertyType || 'sale',
            amount: Number(d.propertyPrice || d.escrowAmount || 0),
            status: d.status || 'pending',
            createdAt: d.createdAt 
        }));
        // Sort in-memory by createdAt descending
        transactions.sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
        });

        // Derive stats from listings (Seller)
        //
        // A THIRD vocabulary for "for sale" lived here: `status === 'available'`
        // alone. So a listing an admin had verified — the status the land module's
        // approval writes, and the one /api/farm-nation/listings publishes — was
        // NOT counted as active on its own seller's dashboard. The seller saw a
        // lower number than the market did.
        //
        // isPurchasable is the shared definition, and it honours every spelling.
        const activeListings = properties.filter(p => isPurchasable(p.status)).length;
        const completedDeals = properties.filter(p => p.status === 'sold' || p.status === 'leased').length;
        const totalHectares = properties.reduce((sum, p) => sum + p.size, 0);
        const portfolioValue = properties.reduce((sum, p) => sum + p.price, 0);

        // Derive stats from transactions (Buyer/Investor)
        /**
         * A purchase is acquired OR pending, never both.
         *
         * `payment_confirmed` was counted in both sets. It means the buyer has
         * paid and the admin has NOT yet released escrow or transferred the
         * title — so the same transaction was reported as a property the buyer
         * owns AND as one still in progress, and its value was added to
         * "total investment" for land they do not hold yet.
         *
         * Ownership transfers when the escrow is released, which is what moves
         * the transaction to "completed". That is the line.
         */
        const completedPurchases = transactions.filter(t => t.status === 'completed');
        const propertiesAcquired = completedPurchases.length;
        const totalInvestmentValue = completedPurchases.reduce((sum, t) => sum + t.amount, 0);
        const pendingTransactions = transactions.filter(
            t => t.status === 'pending_payment' || t.status === 'payment_confirmed'
        ).length;

        // User role
        const role = userDoc.data()?.serviceRegistrations?.farmNation?.role
            || userDoc.data()?.farmNation?.role
            || 'buyer';

        const stats: FarmNationDashboardStats = {
            totalHectares,
            activeListings,
            completedDeals,
            portfolioValue,
            pendingTransactions,
            propertiesAcquired,
            totalInvestmentValue,
            recentTransactions: transactions.slice(0, 5),
            recentListings: properties.slice(0, 4),
            role
        };

        return { error: null, success: true as const, data: stats };
    } catch (error: any) { 
        logger.error('getFarmNationDashboardStatsAction error:', error);
        return { success: false as const, data: null, error: error.message, meta: null };
    }
}


export const getFarmNationDashboardStatsAction = withFlexibleSafeAction("getFarmNationDashboardStatsAction", _getFarmNationDashboardStatsAction);
