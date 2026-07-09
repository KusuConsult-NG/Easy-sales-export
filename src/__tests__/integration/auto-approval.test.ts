/**
 * @jest-environment node
 */

import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    processCooperativeRegistration,
    processAcademyRegistration
} from '@/infrastructure/payments/service';
import { getCleanBroadcastList } from '@/lib/broadcast-logic';
import { createTestUser } from './setup';

describe('Auto-Approval & Broadcast Integration Tests', () => {
    const db = getAdminDb();
    let testUser1: { uid: string; email: string };
    let testUser2: { uid: string; email: string };

    beforeEach(async () => {
        // Create test users
        const uniqueId = Math.random().toString(36).substring(7);
        testUser1 = await createTestUser({
            email: `user1_${uniqueId}@example.com`,
            fullName: 'Cooperative Pending User',
            role: 'user',
        });
        testUser2 = await createTestUser({
            email: `user2_${uniqueId}@example.com`,
            fullName: 'Academy Pending User',
            role: 'user',
        });
    });

    afterEach(async () => {
        // Clean up Auth users
        const auth = getAdminAuth();
        try {
            await auth.deleteUser(testUser1.uid);
        } catch (e) {}
        try {
            await auth.deleteUser(testUser2.uid);
        } catch (e) {}

        // Clean up our specific records
        const batch = db.batch();
        
        // Delete cooperative members docs
        batch.delete(db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(testUser1.uid));
        batch.delete(db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(testUser2.uid));
        
        // Find and delete any academy applications for the test users
        const acadSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where('userId', 'in', [testUser1.uid, testUser2.uid])
            .get();
        acadSnap.docs.forEach((doc: any) => batch.delete(doc.ref));

        // Delete processedPayments docs we might create
        batch.delete(db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc('ref-coop-123'));
        batch.delete(db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc('ref-acad-123'));
        batch.delete(db.collection(COLLECTIONS.USERS).doc(testUser1.uid));
        batch.delete(db.collection(COLLECTIONS.USERS).doc(testUser2.uid));

        await batch.commit();
    });

    describe('Cooperative Auto-Approval', () => {
        it('should auto-approve cooperative membership if onboardingCompleted is true', async () => {
            // Set onboardingCompleted to true on the cooperative member doc
            await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(testUser1.uid).set({
                userId: testUser1.uid,
                onboardingCompleted: true,
                membershipStatus: 'pending',
                paymentStatus: 'pending'
            });

            // Call payment registration fulfillment
            await processCooperativeRegistration('ref-coop-123', 10000, testUser1.uid, 'Member');

            // Verify membership status updated to active
            const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(testUser1.uid).get();
            expect(memberDoc.exists).toBe(true);
            expect(memberDoc.data()?.membershipStatus).toBe('active');
            expect(memberDoc.data()?.paymentStatus).toBe('completed');

            // Verify user document updated with role and service registration status
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(testUser1.uid).get();
            expect(userDoc.exists).toBe(true);
            expect(userDoc.data()?.roles).toContain('cooperative_member');
            expect(userDoc.data()?.isVerified).toBe(true);
            expect(userDoc.data()?.serviceRegistrations?.cooperatives?.status).toBe('active');
        });

        it('should keep cooperative membership pending if onboardingCompleted is false or missing', async () => {
            // Set onboardingCompleted to false
            await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(testUser1.uid).set({
                userId: testUser1.uid,
                onboardingCompleted: false,
                membershipStatus: 'pending',
                paymentStatus: 'pending'
            });

            // Call payment registration fulfillment
            await processCooperativeRegistration('ref-coop-123', 10000, testUser1.uid, 'Member');

            // Verify membership status remains pending
            const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(testUser1.uid).get();
            expect(memberDoc.exists).toBe(true);
            expect(memberDoc.data()?.membershipStatus).toBe('pending');
            expect(memberDoc.data()?.paymentStatus).toBe('completed');

            // Verify user doc has legacy_pending_onboarding
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(testUser1.uid).get();
            expect(userDoc.data()?.serviceRegistrations?.cooperatives?.status).toBe('legacy_pending_onboarding');
            expect(userDoc.data()?.roles).not.toContain('cooperative_member');
        });
    });

    describe('Academy Auto-Approval', () => {
        it('should auto-approve academy application if application doc exists', async () => {
            // Create academy application doc
            const appRef = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).add({
                userId: testUser2.uid,
                status: 'pending',
                paymentStatus: 'pending',
                personalInfo: {
                    email: testUser2.email,
                    fullName: 'Academy Pending User'
                }
            });

            // Call payment registration fulfillment
            await processAcademyRegistration('ref-acad-123', 45000, testUser2.uid, 'registration');

            // Verify application status updated to approved
            const appDoc = await appRef.get();
            expect(appDoc.data()?.status).toBe('approved');
            expect(appDoc.data()?.paymentStatus).toBe('completed');

            // Verify user document updated with role and service registration status
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(testUser2.uid).get();
            expect(userDoc.data()?.roles).toContain('academy_participant');
            expect(userDoc.data()?.isVerified).toBe(true);
            expect(userDoc.data()?.serviceRegistrations?.academy?.status).toBe('approved');
        });

        it('should set status to pending if academy application doc does not exist', async () => {
            // Call payment registration fulfillment without creating application doc
            await processAcademyRegistration('ref-acad-123', 45000, testUser2.uid, 'registration');

            // Verify user document updated with status pending (as no app doc was matched)
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(testUser2.uid).get();
            expect(userDoc.data()?.serviceRegistrations?.academy?.status).toBe('pending');
            expect(userDoc.data()?.roles).not.toContain('academy_participant');
        });
    });

    describe('Communications Broadcast unpaid filtering', () => {
        it('should count and filter unpaid users correctly', async () => {
            // 1. Set up an unpaid cooperative member and an unpaid academy user
            await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(testUser1.uid).set({
                userId: testUser1.uid,
                onboardingCompleted: true,
                membershipStatus: 'pending',
                paymentStatus: 'pending',
                createdAt: new Date()
            });

            await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).add({
                userId: testUser2.uid,
                status: 'pending',
                paymentStatus: 'pending',
                personalInfo: {
                    email: testUser2.email,
                    fullName: 'Academy Pending User'
                },
                createdAt: new Date()
            });

            // 2. Fetch list for academy_users with "unpaid" status filter
            const resultAcademy = await getCleanBroadcastList({
                audience: 'academy_users',
                moduleStatus: 'unpaid'
            });

            expect(resultAcademy.success).toBe(true);
            if (resultAcademy.success && resultAcademy.data) {
                // Ensure unpaid user is in recipients list
                const ids = resultAcademy.data.recipients.map(r => r.uid);
                expect(ids).toContain(testUser2.uid);
                expect(resultAcademy.data.moduleStats.unpaid).toBeGreaterThanOrEqual(1);
            }

            // 3. Fetch list for cooperative_members with "unpaid" status filter
            const resultCoop = await getCleanBroadcastList({
                audience: 'cooperative_members',
                moduleStatus: 'unpaid'
            });

            expect(resultCoop.success).toBe(true);
            if (resultCoop.success && resultCoop.data) {
                const ids = resultCoop.data.recipients.map(r => r.uid);
                expect(ids).toContain(testUser1.uid);
                expect(resultCoop.data.moduleStats.unpaid).toBeGreaterThanOrEqual(1);
            }

            // 4. Fetch list for audience "unpaid_applicants" (combined)
            const resultCombined = await getCleanBroadcastList({
                audience: 'unpaid_applicants'
            });

            expect(resultCombined.success).toBe(true);
            if (resultCombined.success && resultCombined.data) {
                const ids = resultCombined.data.recipients.map(r => r.uid);
                expect(ids).toContain(testUser1.uid);
                expect(ids).toContain(testUser2.uid);
            }
        });
    });
});
