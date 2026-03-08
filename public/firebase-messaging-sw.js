// Firebase Cloud Messaging Service Worker
// Handles background push notifications when the app is not in the foreground.
// Place this file at: /public/firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Firebase config is injected at init time from the client.
// We read it from the service worker query params or use defaults.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'FIREBASE_CONFIG') {
        const config = event.data.config;
        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }
    }
});

// Fallback init using publicly-safe config (no secrets — these are client keys)
const firebaseConfig = {
    apiKey: self.__FIREBASE_API_KEY__ || '',
    authDomain: self.__FIREBASE_AUTH_DOMAIN__ || '',
    projectId: self.__FIREBASE_PROJECT_ID__ || '',
    messagingSenderId: self.__FIREBASE_MESSAGING_SENDER_ID__ || '',
    appId: self.__FIREBASE_APP_ID__ || '',
};

if (firebaseConfig.projectId && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

let messaging;
try {
    messaging = firebase.messaging();
} catch (e) {
    // FCM may not be available in all environments
    console.warn('[sw] Firebase Messaging not available:', e);
}

// Handle background messages
if (messaging) {
    messaging.onBackgroundMessage((payload) => {
        const { title = 'Easy Sales Export', body = '', data } = payload.notification || {};
        const link = data?.link || payload.data?.link || '/';

        self.registration.showNotification(title, {
            body,
            icon: '/icons/icon-192x192.png',
            badge: '/icons/badge-72x72.png',
            data: { link },
            requireInteraction: false,
        });
    });
}

// On notification click — open or focus the app
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = event.notification.data?.link || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // If app window is already open, focus it
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.focus();
                    client.postMessage({ type: 'NOTIFICATION_CLICK', link });
                    return;
                }
            }
            // Otherwise open a new window
            if (clients.openWindow) {
                return clients.openWindow(link);
            }
        })
    );
});
