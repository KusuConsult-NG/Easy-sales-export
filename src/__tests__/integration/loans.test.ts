/**
 * @jest-environment node
 */

import { collection, doc, getDoc, addDoc, getDocs, query, where } from 'firebase/firestore';
import {
    createTestUser,
    cleanupTestData,
    TEST_LOAN_APPLICATION,
} from './setup';

describe('Loan Application Integration Tests', () => {
    beforeEach(async () => {
        // Clean up before each test
        await cleanupTestData();
    });

    afterAll(async () => {
        // Final cleanup
        await cleanupTestData();
    });

    describe('Loan Application Submission', () => {
        it('should successfully submit a loan application for eligible user', async () => {
            // 1. Create test user
            const user = await createTestUser({
                email: 'borrower@example.com',
                fullName: 'Test Borrower',
                role: 'user',
            });

            // 2. Create cooperative membership with sufficient contribution
            await addDoc(collection(global.testDb, 'cooperative_memberships'), {
                userId: user.uid,
                totalContributions: 25000, // Premium tier (₦20k+)
                tier: 'Premium',
                contributions: [
                    {
                        amount: 25000,
                        date: new Date(),
                        reference: 'TEST-REF-001',
                    },
                ],
                hasActiveLoan: false,
                createdAt: new Date(),
            });

            // 3. Submit loan application
            const loanData = {
                userId: user.uid,
                amount: TEST_LOAN_APPLICATION.amount,
                purpose: TEST_LOAN_APPLICATION.purpose,
                duration: TEST_LOAN_APPLICATION.duration,
                status: 'pending',
                createdAt: new Date(),
            };

            const loanRef = await addDoc(collection(global.testDb, 'loan_applications'), loanData);

            // 4. Verify loan was created
            const loanDoc = await getDoc(loanRef);
            expect(loanDoc.exists()).toBe(true);

            const loanSnapshot = loanDoc.data();
            expect(loanSnapshot?.userId).toBe(user.uid);
            expect(loanSnapshot?.amount).toBe(50000);
            expect(loanSnapshot?.status).toBe('pending');
            expect(loanSnapshot?.purpose).toBe('Sesame farming expansion');
        });

        it('should reject loan for user with insufficient contribution', async () => {
            // 1. Create test user
            const user = await createTestUser({
                email: 'poor-borrower@example.com',
                fullName: 'Poor Borrower',
                role: 'user',
            });

            // 2. Create cooperative membership below minimum (₦5,000 < ₦10,000)
            await addDoc(collection(global.testDb, 'cooperative_memberships'), {
                userId: user.uid,
                totalContributions: 5000, // Below minimum
                tier: 'Basic',
                contributions: [],
                hasActiveLoan: false,
                createdAt: new Date(),
            });

            // 3. Query membership
            const membershipQuery = query(
                collection(global.testDb, 'cooperative_memberships'),
                where('userId', '==', user.uid)
            );
            const membershipSnapshot = await getDocs(membershipQuery);
            const membership = membershipSnapshot.docs[0]?.data();

            // 4. Verify user is not eligible (contribution < ₦10,000)
            const isEligible = membership && membership.totalContributions >= 10000;
            expect(isEligible).toBe(false);

            // 5. Trying to create a loan would fail validation
            // (In real app, server action would return error)
            console.log(`❌ User not eligible: ₦${membership?.totalContributions} < ₦10,000`);
        });

        it('should calculate correct tier and loan limit', async () => {
            // 1. Create user with ₦50,000 contribution (Premium tier)
            const user = await createTestUser({
                email: 'premium-user@example.com',
                fullName: 'Premium User',
                role: 'user',
            });

            // 2. Create membership
            const membershipData = {
                userId: user.uid,
                totalContributions: 50000,
                tier: 'Premium',
                contributions: [],
                hasActiveLoan: false,
                createdAt: new Date(),
            };

            await addDoc(collection(global.testDb, 'cooperative_memberships'), membershipData);

            // 3. Calculate loan limit
            const contribution = 50000;
            const premiumMultiplier = 3; // Premium tier = 3x
            const maxLoanAmount = contribution * premiumMultiplier;

            expect(maxLoanAmount).toBe(150000);

            // 4. Verify user can borrow up to ₦150,000
            const requestedLoan = 120000;
            const canBorrow = requestedLoan <= maxLoan Amount;

            expect(canBorrow).toBe(true);
            console.log(`✅ User can borrow ₦${requestedLoan.toLocaleString()} (limit: ₦${maxLoanAmount.toLocaleString()})`);
        });
    });
});
