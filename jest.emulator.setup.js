import '@testing-library/jest-dom';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

// Initialize Firebase app for testing
const app = initializeApp({
    projectId: 'demo-test',
    apiKey: 'demo-key', // Not used in emulator
    authDomain: 'demo-test.firebaseapp.com',
});

const db = getFirestore(app);
const auth = getAuth(app);

// Connect to Firebase Emulators
connectFirestoreEmulator(db, 'localhost', 8080);
connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });

// Make available globally for tests
global.testDb = db;
global.testAuth = auth;
global.testApp = app;

console.log('✅ Firebase Emulator connected (Firestore: 8080, Auth: 9099)');
