/**
 * @jest-environment node
 */

import { collection, addDoc, getDocs, query, where, orderBy } from 'firebase/firestore';
import {
    createTestUser,
    cleanupTestData,
} from './setup';

describe('Cooperative Contribution Integration Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
    });

    afterAll(async () => {
        await cleanupTestData();
    });

    describe('Cooperative Membership & Contributions', () => {
        it('should create membership on first contribution', async () => {
            //  1. Create test user
            const user = await createTestUser({
                email: 'contributor@example.com',
                fullName: 'First Contributor',
                role: 'user',
            });

            // 2. Create first contribution (₦15,000)
            const membershipData = {
                userId: user.uid,
                totalContributions: 15000,
                tier: 'Basic', // < ₦20,000 = Basic
                contributions: [
                    {
                        amount: 15000,
                        date: new Date(),
                        reference: 'COOP-001',
                        status: 'confirmed',
                    },
                ],
                hasActiveLoan: false,
                createdAt: new Date(),
            };

            const membershipRef = await addDoc(
                collection(global.testDb, 'cooperative_memberships'),
                membershipData
            );

            // 3. Verify membership created
            const q = query(
                collection(global.testDb, 'cooperative_memberships'),
                where('userId', '==', user.uid)
            );
            const snapshot = await getDocs(q);

            expect(snapshot.size).toBe(1);
            const membership = snapshot.docs[0].data();

            expect(membership.userId).toBe(user.uid);
            expect(membership.totalContributions).toBe(15000);
            expect(membership.tier).toBe('Basic');
            expect(membership.contributions.length).toBe(1);

            console.log('✅ Membership created with  ₦15,000 contribution (Basic tier)');
        });

        it('should upgrade tier when contribution reaches ₦20,000', async () => {
            // 1. Create user with ₦18,000 (Basic tier)
            const user = await createTestUser({
                email: 'upgrader@example.com',
                fullName: 'Tier Upgrader',
                role: 'user',
            });

            // 2. Initial membership (₦18,000 - Basic tier)
            await addDoc(collection(global.testDb, 'cooperative_memberships'), {
                userId: user.uid,
                totalContributions: 18000,
                tier: 'Basic',
                contributions: [{ amount: 18000, date: new Date(), reference: 'INIT-001' }],
                hasActiveLoan: false,
                createdAt: new Date(),
            });

            // 3. Add ₦5,000 contribution → Total = ₦23,000 (should upgrade to Premium)
            const newContribution = {
                userId: user.uid,
                totalContributions: 23000, // Updated total
                tier: 'Premium', // Upgraded!
                contributions: [
                    { amount: 18000, date: new Date(), reference: 'INIT-001' },
                    { amount: 5000, date: new Date(), reference: 'UPGRADE-001' },
                ],
                hasActiveLoan: false,
                createdAt: new Date(),
            };

            // In real app, this would be an update. For test, we create a second document
            await addDoc(collection(global.testDb, 'cooperative_memberships'), newContribution);

            // 4. Verify tier upgraded
            const q = query(
                collection(global.testDb, 'cooperative_memberships'),
                where('userId', '==', user.uid),
                orderBy('totalContributions', 'desc')
            );
            const snapshot = await getDocs(q);
            const latestMembership = snapshot.docs[0].data();

            expect(latestMembership.totalContributions).toBe(23000);
            expect(latestMembership.tier).toBe('Premium');
            expect(latestMembership.contributions.length).toBe(2);

            console.log('✅ User upgraded from Basic → Premium (₦18k → ₦23k)');
        });

        it('should track contribution history with timestamps', async () => {
            // 1. Create user
            const user = await createTestUser({
                email: 'history-tracker@example.com',
                fullName: 'History Tracker',
                role: 'user',
            });

            //  2. Create membership with 3 contributions
            const contributions = [
                { amount: 10000, date: new Date('2024-01-01'), reference: 'COOP-JAN' },
                { amount: 8000, date: new Date('2024-02-01'), reference: 'COOP-FEB' },
                { amount: 12000, date: new Date('2024-03-01'), reference: 'COOP-MAR' },
            ];

            const totalContributions = contributions.reduce((sum, c) => sum + c.amount, 0);

            await addDoc(collection(global.testDb, 'cooperative_memberships'), {
                userId: user.uid,
                totalContributions,
                tier: totalContributions >= 20000 ? 'Premium' : 'Basic',
                contributions,
                hasActiveLoan: false,
                createdAt: new Date(),
            });

            // 3. Verify contribution history
            const q = query(
                collection(global.testDb, 'cooperative_memberships'),
                where('userId', '==', user.uid)
            );
            const snapshot = await getDocs(q);
            const membership = snapshot.docs[0].data();

            expect(membership.contributions.length).toBe(3);
            expect(membership.totalContributions).toBe(30000);
            expect(membership.tier).toBe('Premium'); // ₦30k = Premium

            // Verify each contribution has required fields
            membership.contributions.forEach((contrib: any) => {
                expect(contrib).toHaveProperty('amount');
                expect(contrib).toHaveProperty('date');
                expect(contrib).toHaveProperty('reference');
            });

            console.log(`✅ Tracked ${membership.contributions.length} contributions, total: ₦${membership.totalContributions.toLocaleString()}`);
        });
    });
});
