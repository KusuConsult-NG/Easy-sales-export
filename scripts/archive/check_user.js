const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // I need to see if this exists or if there's an existing initialized admin

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function checkUser() {
  const email = 'tobaisvincent247@gmail.com';
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    console.log('Successfully fetched user data:', userRecord.toJSON());
    
    // Check firestore
    const userDoc = await admin.firestore().collection('users').doc(userRecord.uid).get();
    if (userDoc.exists) {
        console.log('User document data:', userDoc.data());
    } else {
        console.log('No user document found in Firestore.');
    }
  } catch (error) {
    console.log('Error fetching user data:', error);
  }
}

checkUser();
