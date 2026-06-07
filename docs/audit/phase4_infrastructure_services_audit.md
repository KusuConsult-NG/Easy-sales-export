# Phase 4: Infrastructure Services Audit

This audit evaluates the background services, webhooks, and transactional engines of the **Easy Sales Export** platform.

---

## 1. Messaging & Notifications

### 1.1 Messaging Infrastructure
- **System**: Handled in `messages.ts` with custom message routing. Supports user-to-user chat, user-to-admin tickets, and dispute mediation channels.
- **Security**: Server actions guard the channel. Users can only fetch and dispatch messages within channels containing their `userId`.

### 1.2 Notifications Engine
- **Creation & Routing**: Triggered asynchronously for order changes, loan actions, or system announcements via `createNotificationAction` in `notifications.ts`.
- **Read States**: Supports batch marking of notifications as read.
- **Real-Time Delivery**: Interfaced with client hooks that execute real-time updates.

---

## 2. Chatbot & Analytics Engines

### 2.1 Chatbot Service
- **History Logs**: Message history and context variables are logged securely in the `ai_chat_history` collection.
- **Gating**: Verified users maintain standard chat capabilities. Gating prevents unauthenticated access.

### 2.2 Analytics Aggregation
- **Synchronization**: Uses native Firestore `.count()` and aggregate functions (`AggregateField.sum`) to fetch absolute sums.
- **Redis Cache**: Dashboard statistics are cached via Redis for 2 minutes (`setCache`) to prevent excessive database lookups. Webhook payments delete the cache immediately upon success.

---

## 3. Escrow & Payment Engines

### 3.1 Escrow Auto-Release Engine
- **Cron Gating**: Triggered by a cron GET route secured via `CRON_SECRET` authorization.
- **Release Threshold**: Standard dispute window is **7 days**.
- **Delivered Exports**: Automatically completes window states past `escrowReleaseDate`, calculating ROI returns (e.g. 15%) and depositing payouts directly into cooperative savings balances.
- **Marketplace Escrow**: Checks for requests older than 7 days without active disputes. Upon expiration:
  - Updates escrow status to `"released"`.
  - Credits the seller's wallet balance directly.
  - Adds a ledger entry (`type: "escrow_payout"`) to the transactions collection.
  - Logs `escrow_released` in audit logs and notifies both buyer and seller.

### 3.2 Payment Engine & Webhook Integrity
- **Signature Verification**: The POST route verifies Paystack signature headers (`x-paystack-signature`) against the local `PAYSTACK_SECRET_KEY` config.
- **Deduplication**: Webhooks query the `processedPayments` collection using the transaction reference as the document ID to prevent duplicate processing.
- **Gating Retries**: If the processing throws an error, the webhook returns a `500` status to prompt Paystack to retry. On success, it clears Redis cache keys immediately.
- **Declines & Abandonment**: Declined (`charge.failed`) and abandoned checkouts are logged in the `failedPayments` collection, storing channel, email, amount, and gateway error reasons.
