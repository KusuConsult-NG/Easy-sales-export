const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp, cert } = require('firebase-admin/app');
const path = require('path');

// Try initializing with env var if available, else load from known location if any
// This project uses Next.js, so server reads from process.env.FIREBASE_PRIVATE_KEY
// Let's just create a test file inside Next.js and use curl instead!
