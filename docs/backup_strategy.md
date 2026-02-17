# Database Backup Strategy 💾

## Overview
To ensure business continuity and data safety for the **Easy Sales Export** platform (100k+ users), we implement a multi-tiered backup strategy for Firestore and Cloud Storage.

---

## 1. Automated Firestore Backups (GCP)
We utilize Google Cloud Scheduler to trigger daily export operations.

### Configuration
- **Frequency:** Daily at 02:00 UTC
- **Retention:** 30 Days (Lifecycle Rule on GCS Bucket)
- **Destination:** `gs://easy-sales-export-backups/{date}`

### setup Command (One-Time)
```bash
# 1. Create a Storage Bucket
gcloud storage buckets create gs://easy-sales-export-backups --location=europe-west1

# 2. Configure Lifecycle Rule (Delete after 30 days)
gcloud storage buckets update gs://easy-sales-export-backups --lifecycle-file=lifecycle.json

# 3. Create Cloud Scheduler Job
gcloud scheduler jobs create http firestore-backup-daily \
    --schedule="0 2 * * *" \
    --uri="https://firestore.googleapis.com/v1/projects/YOUR_PROJECT_ID/databases/(default):exportDocuments" \
    --message-body='{"outputUriPrefix":"gs://easy-sales-export-backups/daily"}' \
    --oauth-service-account-email="YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

---

## 2. Manual Backup (Emergency)
Run this command before any major migration or risky deployment.

```bash
gcloud firestore export gs://easy-sales-export-backups/manual_$(date +%Y%m%d_%H%M%S) --async
```

---

## 3. Local Emulator Backup
For development state preservation.

```bash
# Export local data
firebase emulators:export ./emulator-data

# Start with saved data
firebase emulators:start --import=./emulator-data
```

---

## 4. Disaster Recovery (Restore)
**restore Time Objective (RTO):** < 4 Hours
**restore Point Objective (RPO):** < 24 Hours

### Restoration Steps
1.  **Identify Backup:** Locate the correct folder in GCS bucket (e.g., `daily/2026-02-17T02:00:00`).
2.  **Import Command:**
    ```bash
    gcloud firestore import gs://easy-sales-export-backups/daily/2026-02-17T02:00:00 --async
    ```
3.  **Verify Data:** Check key collections (`users`, `orders`, `wallet_transactions`).

---

## 5. Storage (Files) Backup
Cloud Storage has built-in redundancy, but for protection against accidental deletion:
- **Enable Object Versioning:**
    ```bash
    gsutil versioning set on gs://your-firebase-storage-bucket
    ```
- **Lifecycle:** Delete noncurrent versions after 7 days to save costs.
