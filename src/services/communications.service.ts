import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
//   Both spellings of each marketplace role. See the note on the `sellers`
//   branch below for what asking for one of the two silently cost.
import { SELLER_ROLES } from "@/lib/seller-approval";
import { MARKETPLACE_BUYER_ROLES } from "@/lib/role-app-mapping";
import type { CommunicationsServiceContract } from "@easy-sales/services";

/**
 * Communications Service
 * 
 * Manages email and SMS notifications targeting.
 * Firebase is the ONLY source of truth for communications targeting.
 */
export class CommunicationsService implements CommunicationsServiceContract {
    /**
     * Gets a verified list of user emails for a targeted broadcast using true domain collections.
     */
    static async getTargetedUsers(
        audience: "all" | "cooperative" | "marketplace" | "academy" | "wave" | "active" | "verified" | "sellers" | string,
        status?: "approved" | "pending" | "rejected" | string
    ): Promise<string[]> {
        const db = getAdminDb();
        const emails: string[] = [];

        logger.info(`[CommsService] getTargetedUsers called with audience: '${audience}', status: '${status || "none"}'`);

        try {
            if (audience === "cooperative") {
                let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
                if (status) {
                    // Map common statuses to cooperative fields
                    if (status === "approved" || status === "active") {
                        query = query.where("membershipStatus", "in", ["approved", "active"]);
                    } else {
                        query = query.where("membershipStatus", "==", status);
                    }
                } else {
                    // Default to paid cooperative members
                    query = query.where("paymentStatus", "==", "completed");
                }
                const snap = await query.select("email").limit(10000).get();
                snap.docs.forEach(doc => {
                    const data = doc.data();
                    if (data.email) emails.push(data.email);
                });
                logger.info(`[CommsService] cooperative targeting: ${emails.length} emails found`);
            } else if (audience === "wave") {
                let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.WAVE_APPLICATIONS);
                if (status) {
                    query = query.where("status", "==", status);
                }
                const snap = await query.select("email", "userEmail").limit(10000).get();
                snap.docs.forEach(doc => {
                    const data = doc.data();
                    const email = data.email || data.userEmail;
                    if (email) emails.push(email);
                });
                logger.info(`[CommsService] wave targeting: ${emails.length} emails found`);
            } else if (audience === "academy") {
                let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS);
                if (status) {
                    query = query.where("status", "==", status);
                }
                const snap = await query.select("email", "userEmail").limit(10000).get();
                snap.docs.forEach(doc => {
                    const data = doc.data();
                    const email = data.email || data.userEmail;
                    if (email) emails.push(email);
                });
                logger.info(`[CommsService] academy targeting: ${emails.length} emails found`);
            } else {
                // Query root users collection
                let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.USERS);
                
                switch (audience) {
                    case "active":
                        query = query.where("status", "==", "active");
                        break;
                    case "verified":
                        query = query.where("verified", "==", true);
                        break;
                    case "sellers":
                        /*
                         *   BOTH SPELLINGS, and asking for one was silently
                         *   losing people.
                         *
                         *   This was `array-contains "seller"`, and the role
                         *   vocabulary carries two names for the same thing —
                         *   lib/seller-approval declares
                         *   SELLER_ROLES = ["seller", "marketplace_seller"]
                         *   and roles.ts calls the second "the new standardized
                         *   role". So a broadcast to sellers reached the ones
                         *   holding the old spelling and nobody else, with no
                         *   error and a plausible-looking count in the log.
                         *
                         *   A reader narrower than its writers, on an admin
                         *   broadcast — where the symptom is simply that some
                         *   sellers were never told.
                         */
                        query = query.where("roles", "array-contains-any", [...SELLER_ROLES]);
                        break;
                    case "marketplace":
                        // Fetch all and filter in memory to support buyer or seller role checks
                        break;
                    case "all":
                    default:
                        break;
                }

                const snap = await query.select("email", "roles", "status").limit(10000).get();
                snap.docs.forEach(doc => {
                    const data = doc.data();
                    if (data.status === "suspended") return;
                    
                    if (audience === "marketplace") {
                        //   Both spellings of both roles, for the reason given
                        //   on the `sellers` branch above. This asked for
                        //   "buyer" or "seller" and so missed every
                        //   marketplace_buyer and marketplace_seller.
                        const held: string[] = Array.isArray(data.roles) ? data.roles : [];
                        const hasRole = [...MARKETPLACE_BUYER_ROLES, ...SELLER_ROLES]
                            .some((role) => held.includes(role));
                        if (hasRole && data.email) emails.push(data.email);
                    } else {
                        if (data.email) emails.push(data.email);
                    }
                });
                logger.info(`[CommsService] users collection targeting for '${audience}': ${emails.length} emails found`);
            }

            const uniqueEmails = [...new Set(emails)];
            logger.info(`[CommsService] Returning ${uniqueEmails.length} unique emails`);
            return uniqueEmails;
        } catch (error) {
            logger.error(`[CommsService] Error resolving targeted users for '${audience}':`, error);
            return [];
        }
    }

    async getTargetedUsers(
        audience: "all" | "cooperative" | "marketplace" | "academy" | "wave" | "active" | "verified" | "sellers" | string,
        status?: "approved" | "pending" | "rejected" | string
    ): Promise<string[]> {
        return CommunicationsService.getTargetedUsers(audience, status);
    }
}
