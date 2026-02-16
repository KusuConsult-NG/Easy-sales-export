# Database & Storage Backup Strategy

## Overview
This document outlines the disaster recovery and data safety strategy for the **Easy Sales Export** platform.

**Critical Data Sources:**
1. **Firestore Database**: User profiles, orders, product listings, etc.
2. **Firebase Storage**: User uploads, product images, verification documents.

---

## 1. Firestore Backup (Automated)

### Prerequisites
- Google Cloud Project linked to Firebase.
- Billing enabled (required for Cloud Scheduler/Cloud Functions).
- A Google Cloud Storage Bucket for backups (e.g., `gs://easy-sales-backups`).

### Setup Instructions

1. **Create Storage Bucket**:
   ```bash
   gsutil mb -p [PROJECT_ID] -l [LOCATION] gs://easy-sales-backups
   ```

2. **Configure IAM Permissions**:
   The default service account needs permission to export to storage.
   - Role: `Storage Admin` (or `Storage Object Creator`)

3. **Schedule Export (Cloud Scheduler)**:
   Create a job to run daily at 3 AM WAT.
   - **Method**: HTTP POST
   - **URL**: `https://firestore.googleapis.com/v1/projects/[PROJECT_ID]/databases/(default):exportDocuments`
   - **Body**:
     ```json
     { "outputUriPrefix": "gs://easy-sales-backups/daily" }
     ```
   - **Auth**: OIDC Token (Select Default App Engine Service Account)

---

## 2. Firestore Backup (Manual)

Run this command from your local terminal (requires `gcloud` CLI):

```bash
gcloud firestore export gs://easy-sales-backups/manual_$(date +%Y%m%d_%H%M%S) --async
```

To import/restore:
```bash
gcloud firestore import gs://easy-sales-backups/[BACKUP_FOLDER_NAME] --async
```

---

## 3. Firebase Storage Backup

Storage buckets are durable, but accidental deletion by admins or malicious scripts can happen.

### Strategy
1. **Enable Object Versioning**:
   Allows you to recover deleted or overwritten objects.
   ```bash
   gsutil versioning set on gs://[YOUR_STORAGE_BUCKET]
   ```

2. **Cross-Region Replication (Optional)**:
   For high availability, configure your bucket to be multi-region.

---

## 4. Disaster Recovery Drill

**Frequency**: Once per quarter.

**Steps**:
1. Create a fresh Firebase project (staging).
2. Run the restore command using the latest production backup.
3. Verify that the app functionality (listing products, viewing orders) works on the restored data.
