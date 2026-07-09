export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from '@/lib/types/firestore';
import { logger } from '@/lib/logger';

export async function GET() {
    try {
        const session = (await requireSession()).session;

        // 1. Authenticate Request
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            logger.warn(`Unauthorized Reconcile Sweep attempt by UID: ${session?.user?.id}`);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const adminDb = getAdminDb();
        const usersSnapshot = await adminDb.collection(COLLECTIONS.USERS).get();
        
        let fragmentedUsers = 0;
        const scanResults = [];

        // 2. Iterate User Profiles
        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            const uid = userDoc.id;
            const registrations = userData.serviceRegistrations || {};

            let hasFragmentation = false;
            const fragments = [];

            // A. Check Cooperative Mismatch
            if (registrations.cooperative) {
                const globalStatus = registrations.cooperative.status;
                const memberRef = await adminDb.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(uid).get();
                if (memberRef.exists) {
                    const localStatus = memberRef.data()?.status || 'UNKNOWN';
                    if (globalStatus !== localStatus) {
                        fragments.push(`Cooperative: Global=${globalStatus}, Local=${localStatus}`);
                        hasFragmentation = true;
                    }
                }
            }

            // B. Check Export Mismatch
            if (registrations.export) {
                const globalStatus = registrations.export.status;
                const exportRef = await adminDb.collection('EXPORT_APPLICATIONS').doc(uid).get();
                if (exportRef.exists) {
                    const localStatus = exportRef.data()?.status || 'UNKNOWN';
                    if (globalStatus !== localStatus) {
                        fragments.push(`Export: Global=${globalStatus}, Local=${localStatus}`);
                        hasFragmentation = true;
                    }
                }
            }

            // C. Check WAVE Mismatch
            if (registrations.wave) {
                const globalStatus = registrations.wave.status;
                const waveRef = await adminDb.collection('WAVE_APPLICATIONS').doc(uid).get();
                if (waveRef.exists) {
                    const localStatus = waveRef.data()?.status || waveRef.data()?.applicationStatus || 'UNKNOWN';
                    // Allow acceptable divergence terms based on WAVE terminology
                    if (globalStatus !== localStatus && !(globalStatus === 'ACTIVE' && localStatus === 'APPROVED')) {
                        fragments.push(`WAVE: Global=${globalStatus}, Local=${localStatus}`);
                        hasFragmentation = true;
                    }
                }
            }

            if (hasFragmentation) {
                fragmentedUsers++;
                scanResults.push({
                    uid,
                    email: userData.email,
                    displayName: userData.fullName || 'Unknown',
                    fragments
                });
            }
        }

        return NextResponse.json({
            status: 'success',
            meta: {
                scanned_total: usersSnapshot.size,
                fragmented_count: fragmentedUsers,
                note: 'This was a READ-ONLY diagnostic sweep. No records were modified.'
            },
            fragmented_users: scanResults
        });

    } catch (error) {
        logger.error('Failed to perform reconcile sweep:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}
