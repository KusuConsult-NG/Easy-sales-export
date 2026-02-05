# How to Get Firebase Web App Configuration

## What You Need
The Firebase **Web App Config** (not the service account JSON you provided).

## Steps:

1. Go to Firebase Console: https://console.firebase.google.com/u/4/project/easy-sales-hub

2. Click the **Gear icon** ⚙️ (Project Settings) in the left sidebar

3. Scroll down to **"Your apps"** section

4. Look for a **Web App** (icon: </>)
   - If you don't see one, click **"Add app"** → Select **Web** → Register it

5. Click on your web app to see the config

6. Copy the **firebaseConfig** object which looks like:
```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "easy-sales-hub.firebaseapp.com",
  projectId: "easy-sales-hub",
  storageBucket: "easy-sales-hub.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

## What to do next:
Provide those 6 values and I'll update your .env.local file directly.

---

## Note: Service Account vs Web App Config
- **Service Account** (what you provided): For server-side Firebase Admin SDK
- **Web App Config** (what we need): For client-side Firebase in the browser
