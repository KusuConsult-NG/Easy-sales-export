# Railway Cron Jobs Setup

Since this application is deployed on **Railway** rather than Vercel, cron jobs are not driven by a `vercel.json` file. Instead, Railway provides native Cron scheduling via the Railway Dashboard.

## Setting up the GDPR Purge Cron Job

The platform relies on a daily cron job to enforce GDPR's "Right-to-be-Forgotten" by purging users and PII data that have been marked for deletion for 30 days.

To configure this in Railway:

1. Go to your **Railway Dashboard**.
2. Select your Next.js project.
3. Click **New** -> **Service** -> **Empty Service**.
4. Name the service **GDPR Cron Trigger**.
5. Go to the **Settings** tab of this new service.
6. Under **Service Mode**, change it from "Service" to **Cron Job**.
7. Set the **Cron Schedule** to run daily. Use this expression:
   ```text
   0 0 * * *
   ```
   *(This runs the cron job every day at midnight).*
8. Set the **Start Command** to trigger the API route:
   ```bash
   curl -X GET "https://easysalesexport.com/api/cron/gdpr-purge" -H "Authorization: Bearer $CRON_SECRET"
   ```
   *(Replace the URL with your actual production URL if different).*
9. Go to the **Variables** tab of this new service and add the `CRON_SECRET` variable, ensuring it perfectly matches the `CRON_SECRET` variable defined in your main Next.js service.

Railway will now automatically ping that endpoint every day, and the Next.js app will validate the `CRON_SECRET` and execute the secure PII sweep.

## Sentry Configuration

Sentry is integrated natively using `@sentry/nextjs`. The global error boundary now captures unhandled exceptions and routes them to your Sentry dashboard.
Ensure you add the following variables to your Railway Next.js service:

- `NEXT_PUBLIC_SENTRY_DSN`: Your Sentry project DSN.
- `SENTRY_AUTH_TOKEN`: Your auth token for source map uploads (optional but recommended).
