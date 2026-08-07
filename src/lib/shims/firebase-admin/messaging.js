/**
 * Firebase Admin Messaging shim.
 *
 * No FCM credentials are configured for this project — Firebase is shimmed to
 * Supabase and no push provider has replaced it.
 *
 * This shim used to return `"mock-message-id"` from send() and
 * `{ successCount: 1, failureCount: 0 }` from sendEachForMulticast(), so
 * src/lib/fcm.ts logged "[fcm] Push sent to uid=..." and reported success for
 * every notification the platform has ever attempted — order placed, escrow
 * released, withdrawal decisions, dispute resolutions, admin broadcasts. None
 * were delivered, and the logs asserted the opposite, which is why it never
 * surfaced in monitoring.
 *
 * It now reports failure honestly. fcm.ts already treats a rejected send as a
 * non-fatal failure and returns { success: false, error }, so callers are
 * unaffected — but the logs and any metrics now tell the truth.
 *
 * To restore push delivery, wire a real provider here (or replace fcm.ts).
 */
const NOT_CONFIGURED =
  'Push messaging is not configured: no FCM credentials and no replacement ' +
  'provider. See src/lib/shims/firebase-admin/messaging.js';

module.exports = {
  getMessaging: () => ({
    send: async () => {
      throw new Error(NOT_CONFIGURED);
    },
    sendEachForMulticast: async (message) => {
      const count = message?.tokens?.length ?? 0;
      return {
        successCount: 0,
        failureCount: count,
        responses: Array.from({ length: count }, () => ({
          success: false,
          error: new Error(NOT_CONFIGURED),
        })),
      };
    },
  })
};
