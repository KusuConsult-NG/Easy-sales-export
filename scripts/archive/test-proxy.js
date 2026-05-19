require('dotenv').config({ path: '.env.local' });
const { adminAuth } = require('./src/lib/firebase-admin.ts'); // Wait, ts file, I need to use tsx.
