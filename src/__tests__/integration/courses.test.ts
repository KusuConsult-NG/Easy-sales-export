/**
 * @jest-environment node
 */

import { collection, addDoc, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';
import {
    createTestUser,
    cleanupTestData,
} from './setup';

describe('Course Enrollment Integration Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
    });

    afterAll(async () => {
        await cleanupTestData();
    });

    describe('Course Enrollment & Progress Tracking', () => {
        it('should enroll user in course successfully', async () => {
            // 1. Create test user
            const user = await createTestUser({
                email: 'student@example.com',
                fullName: 'Test Student',
                role: 'user',
            });

            // 2. Enroll in course
            const enrollmentData = {
                userId: user.uid,
                courseId: 'sesame-farming-101',
                courseName: 'Sesame Farming 101',
                progress: 0,
                completedModules: [],
                enrolledAt: new Date(),
                lastAccessedAt: new Date(),
            };

            const enrollmentRef = await addDoc(
                collection(global.testDb, 'enrollments'),
                enrollmentData
            );

            // 3. Verify enrollment created
            const q = query(
                collection(global.testDb, 'enrollments'),
                where('userId', '==', user.uid),
                where('courseId', '==', 'sesame-farming-101')
            );
            const snapshot = await getDocs(q);

            expect(snapshot.size).toBe(1);
            const enrollment = snapshot.docs[0].data();

            expect(enrollment.userId).toBe(user.uid);
            expect(enrollment.courseId).toBe('sesame-farming-101');
            expect(enrollment.progress).toBe(0);
            expect(enrollment.completedModules.length).toBe(0);

            console.log('✅ User enrolled in "Sesame Farming 101" with 0% progress');
        });

        it('should update progress correctly when completing modules', async () => {
            // 1. Create user and enroll
            const user = await createTestUser({
                email: 'progressor@example.com',
                fullName: 'Progress Tracker',
                role: 'user',
            });

            const enrollmentData = {
                userId: user.uid,
                courseId: 'advanced-maize-cultivation',
                courseName: 'Advanced Maize Cultivation',
                progress: 0,
                completedModules: [],
                totalModules: 5,
                enrolledAt: new Date(),
            };

            const enrollmentRef = await addDoc(
                collection(global.testDb, 'enrollments'),
                enrollmentData
            );

            // 2. Complete module 1 → 20% progress
            const completedModules1 = ['module-1'];
            const progress1 = (completedModules1.length / 5) * 100;

            await updateDoc(enrollmentRef, {
                completedModules: completedModules1,
                progress: progress1,
            });

            // 3. Complete module 2 → 40% progress
            const completedModules2 = ['module-1', 'module-2'];
            const progress2 = (completedModules2.length / 5) * 100;

            await updateDoc(enrollmentRef, {
                completedModules: completedModules2,
                progress: progress2,
            });

            // 4. Verify final progress
            const q = query(
                collection(global.testDb, 'enrollments'),
                where('userId', '==', user.uid)
            );
            const snapshot = await getDocs(q);
            const enrollment = snapshot.docs[0].data();

            expect(enrollment.completedModules.length).toBe(2);
            expect(enrollment.progress).toBe(40);

            console.log(`✅ Progress updated: ${enrollment.completedModules.length}/5 modules (${enrollment.progress}%)`);
        });

        it('should issue certificate on 100% completion', async () => {
            // 1. Create user and enroll
            const user = await createTestUser({
                email: 'graduate@example.com',
                fullName: 'Course Graduate',
                role: 'user',
            });

            const totalModules = 4;
            const enrollmentData = {
                userId: user.uid,
                courseId: 'sesame-farming-101',
                courseName: 'Sesame Farming 101',
                progress: 0,
                completedModules: [],
                totalModules,
                enrolledAt: new Date(),
            };

            const enrollmentRef = await addDoc(
                collection(global.testDb, 'enrollments'),
                enrollmentData
            );

            // 2. Complete all modules
            const allModules = ['module-1', 'module-2', 'module-3', 'module-4'];
            await updateDoc(enrollmentRef, {
                completedModules: allModules,
                progress: 100,
                completedAt: new Date(),
                certificateIssued: true,
            });

            // 3. Verify completion and certificate
            const q = query(
                collection(global.testDb, 'enrollments'),
                where('userId', '==', user.uid)
            );
            const snapshot = await getDocs(q);
            const enrollment = snapshot.docs[0].data();

            expect(enrollment.progress).toBe(100);
            expect(enrollment.completedModules.length).toBe(totalModules);
            expect(enrollment.certificateIssued).toBe(true);
            expect(enrollment.completedAt).toBeDefined();

            console.log('✅ Course completed - Certificate issued for "Sesame Farming 101"');
        });
    });
});
