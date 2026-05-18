import { getAdminDb } from "@/lib/firebase-admin";

/**
 * Communications Service
 * 
 * Manages email and SMS notifications targeting.
 * Firebase is the ONLY source of truth for communications targeting.
 */

export class CommunicationsService {
    /**
     * Gets a verified list of users for a targeted broadcast.
     */
    static async getTargetedUsers(audience: 'all' | 'cooperative' | 'marketplace') {
        const db = getAdminDb();
        const usersSnap = await db.collection("users").get();
        
        const targets: string[] = [];
        
        usersSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.status === 'suspended') return;
            
            if (audience === 'all') {
                if (data.email) targets.push(data.email);
            } else if (audience === 'cooperative') {
                if (data.roles?.includes('cooperative_member') && data.email) {
                    targets.push(data.email);
                }
            } else if (audience === 'marketplace') {
                if ((data.roles?.includes('buyer') || data.roles?.includes('seller')) && data.email) {
                    targets.push(data.email);
                }
            }
        });
        
        return targets;
    }
}
