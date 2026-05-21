import '@testing-library/jest-dom';
import { initializeApp } from 'firebase/app';
import { initializeFirestore, connectFirestoreEmulator, terminate } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

// Initialize Firebase app for testing
const app = initializeApp({
    projectId: 'demo-test',
    apiKey: 'demo-key', // Not used in emulator
    authDomain: 'demo-test.firebaseapp.com',
});

const db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
});
const auth = getAuth(app);

// Connect to Firebase Emulators
connectFirestoreEmulator(db, 'localhost', 8080);
connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });

// Make available globally for tests
global.testDb = db;
global.testAuth = auth;
global.testApp = app;

console.log('✅ Firebase Emulator connected (Firestore: 8080, Auth: 9099)');

// Clean up Firestore connections after all tests in each suite have completed
afterAll(async () => {
    if (global.testDb) {
        try {
            await terminate(global.testDb);
            console.log('✅ Terminated global.testDb successfully');
        } catch (err) {
            console.error('Failed to terminate global.testDb:', err);
        }
    }
});

