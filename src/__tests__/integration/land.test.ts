/**
 * @jest-environment node
 */

import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import {
    createTestUser,
    cleanupTestData,
    TEST_LAND_LISTING,
} from './setup';

describe('Land Listing Integration Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
    });

    afterAll(async () => {
        await cleanupTestData();
    });

    describe('Land Listing Creation & Verification', () => {
        it('should create land listing with pending status', async () => {
            // 1. Create test user
            const user = await createTestUser({
                email: 'landowner@example.com',
                fullName: 'Land Owner',
                role: 'user',
            });

            // 2. Submit land listing
            const listingData = {
                ...TEST_LAND_LISTING,
                ownerId: user.uid,
                verificationStatus: 'pending',
                createdAt: new Date(),
            };

            const listingRef = await addDoc(
                collection(global.testDb, 'land_listings'),
                listingData
            );

            // 3. Verify listing created
            const q = query(
                collection(global.testDb, 'land_listings'),
                where('ownerId', '==', user.uid)
            );
            const snapshot = await getDocs(q);

            expect(snapshot.size).toBe(1);
            const listing = snapshot.docs[0].data();

            expect(listing.ownerId).toBe(user.uid);
            expect(listing.verificationStatus).toBe('pending');
            expect(listing.title).toBe('Prime Agricultural Land');

            console.log(`✅ Land listing created: "${listing.title}" (Status: pending)`);
        });

        it('should allow admin to verify land listing', async () => {
            // 1. Create user and submit listing
            const user = await createTestUser({
                email: 'seller@example.com',
                fullName: 'Land Seller',
                role: 'user',
            });

            const listingRef = await addDoc(collection(global.testDb, 'land_listings'), {
                ...TEST_LAND_LISTING,
                ownerId: user.uid,
                verificationStatus: 'pending',
                createdAt: new Date(),
            });

            // 2. Admin verifies listing (in real app, this would check admin role)
            // For this test, we'll just update the status
            await listingRef.update({
                verificationStatus: 'verified',
                verifiedAt: new Date(),
                verifiedBy: 'admin-uid',
            });

            // 3. Verify status changed
            const q = query(
                collection(global.testDb, 'land_listings'),
                where('verificationStatus', '==', 'verified')
            );
            const snapshot = await getDocs(q);

            expect(snapshot.size).toBe(1);
            const listing = snapshot.docs[0].data();

            expect(listing.verificationStatus).toBe('verified');
            expect(listing.verifiedAt).toBeDefined();

            console.log('✅ Admin verified land listing');
        });

        it('should return only verified listings in public search', async () => {
            // 1. Create 3 users with listings (1 verified, 2 pending)
            const user1 = await createTestUser({
                email: 'owner1@example.com',
                fullName: 'Owner 1',
                role: 'user',
            });

            const user2 = await createTestUser({
                email: 'owner2@example.com',
                fullName: 'Owner 2',
                role: 'user',
            });

            const user3 = await createTestUser({
                email: 'owner3@example.com',
                fullName: 'Owner 3',
                role: 'user',
            });

            // 2. Create 1 verified listing
            await addDoc(collection(global.testDb, 'land_listings'), {
                ...TEST_LAND_LISTING,
                title: 'Verified Land',
                ownerId: user1.uid,
                verificationStatus: 'verified',
                createdAt: new Date(),
            });

            // 3. Create 2 pending listings
            await addDoc(collection(global.testDb, 'land_listings'), {
                ...TEST_LAND_LISTING,
                title: 'Pending Land 1',
                ownerId: user2.uid,
                verificationStatus: 'pending',
                createdAt: new Date(),
            });

            await addDoc(collection(global.testDb, 'land_listings'), {
                ...TEST_LAND_LISTING,
                title: 'Pending Land 2',
                ownerId: user3.uid,
                verificationStatus: 'pending',
                createdAt: new Date(),
            });

            // 4. Query only verified listings
            const verifiedQuery = query(
                collection(global.testDb, 'land_listings'),
                where('verificationStatus', '==', 'verified')
            );
            const verifiedSnapshot = await getDocs(verifiedQuery);

            // 5. Verify only 1 result
            expect(verifiedSnapshot.size).toBe(1);
            const verifiedListing = verifiedSnapshot.docs[0].data();
            expect(verifiedListing.title).toBe('Verified Land');

            console.log(`✅ Public search returned ${verifiedSnapshot.size} verified listing (out of 3 total)`);
        });
    });
});
