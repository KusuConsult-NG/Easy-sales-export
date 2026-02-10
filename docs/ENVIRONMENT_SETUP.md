# Environment Setup Guide

This guide explains how to securely configure environment variables for the Easy Sales Export platform.

## 🔐 Security First

> [!CAUTION]
> **NEVER commit `.env.local` to version control**
> 
> The `.env.local` file contains sensitive credentials that should never be shared publicly. Verify it's in `.gitignore`:
> ```bash
> git check-ignore .env.local
> # Expected output: .env.local
> ```

---

## Quick Start

### 1. Create Your Environment File

```bash
cp .env.example .env.local
```

### 2. Generate Production Secrets

Run the automated script to generate cryptographically secure secrets:

```bash
./scripts/generate-secrets.sh
```

This will output three critical secrets:
- `NEXTAUTH_SECRET` - For session encryption
- `MFA_SECRET_KEY` - For two-factor authentication
- `QR_ENCRYPTION_KEY` - For digital ID QR codes

Copy each value to your `.env.local` file.

---

## Required Services

### Firebase (Authentication & Database)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project → Project Settings
3. Copy the configuration values:
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`

4. For server-side admin access:
   - Go to Project Settings → Service Accounts
   - Click "Generate New Private Key"
   - Copy values to `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

### Paystack (Payment Gateway)

1. Go to [Paystack Dashboard](https://dashboard.paystack.com/)
2. Navigate to Settings → API Keys & Webhooks

**For Development (TEST mode):**
```bash
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_...
PAYSTACK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_PAYSTACK_LIVE_MODE=false
```

**For Production (LIVE mode):**
```bash
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_live_...
PAYSTACK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_PAYSTACK_LIVE_MODE=true
```

> [!WARNING]
> **Test Mode vs Live Mode**
> 
> - TEST mode: No real money is processed
> - LIVE mode: Real transactions, requires business verification
> 
> Always test thoroughly in TEST mode before switching to LIVE.

### Resend (Email Service)

1. Go to [Resend Dashboard](https://resend.com/api-keys)
2. Generate a new API key
3. Add to your `.env.local`:
   ```bash
   RESEND_API_KEY=re_...
   ```

---

## Optional Integrations

### OpenAI API (AI Assistant)

> [!CAUTION]
> **Protect Your API Key**
> 
> OpenAI API usage incurs costs. Keep this key secure and monitor usage in your OpenAI dashboard.

1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create a new secret key
3. Add to `.env.local`:
   ```bash
   OPENAI_API_KEY=sk-proj-...
   ```

### Cloudinary (Image Upload)

1. Go to [Cloudinary Console](https://cloudinary.com/console)
2. Copy your cloud name, API key, and API secret
3. Add to `.env.local`

---

## Production Deployment

### Vercel

1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add each variable individually:
   - Set "Environment" to "Production"
   - Paste the value
   - Click "Save"

### Other Platforms (Railway, Render, etc.)

Follow the platform's documentation for adding environment variables. All platforms have dashboards for managing secrets securely.

---

## Security Validation

The platform includes runtime security checks to prevent weak secrets in production.

### Run Validation Manually

```bash
NODE_ENV=production npm run build
```

This will fail if any of the following are detected:
- Weak or demo secrets
- Missing required variables
- Secrets shorter than 32 characters

---

## Secret Rotation

> [!IMPORTANT]
> **Rotate secrets every 90 days**

To rotate a secret:

1. Generate new value: `openssl rand -base64 48`
2. Update in `.env.local` (development)
3. Update in deployment platform (production)
4. Monitor for authentication errors
5. Update backup/disaster recovery documentation

---

## Emergency: Exposed Secrets

If you accidentally commit secrets to git:

### 1. Rotate Immediately

**Firebase:**
- Delete the service account in Firebase Console
- Generate a new one

**Paystack:**
- Go to Settings → API Keys
- Delete the exposed key
- Generate a new one

**OpenAI:**
- Go to https://platform.openai.com/api-keys
- Delete the exposed key
- Create a new key

**NextAuth/MFA/QR Secrets:**
```bash
./scripts/generate-secrets.sh
```

### 2. Update Everywhere

- Development: `.env.local`
- Production: Deployment platform environment variables
- Team: Notify via secure channels (not email/Slack)

### 3. Monitor for Abuse

- Check Paystack transaction logs
- Check OpenAI usage dashboard
- Review Firebase usage metrics

---

## Checklist: Production Readiness

Before deploying:

- [ ] All secrets generated with `openssl rand -base64 48`
- [ ] `.env.local` is in `.gitignore`
- [ ] No secrets in git history
- [ ] Paystack LIVE mode keys configured
- [ ] Email service (Resend) tested
- [ ] Bank verification tested with real accounts
- [ ] Production build succeeds: `npm run build`
- [ ] Security validation passes
- [ ] Backup recovery procedure documented

---

## Troubleshooting

### "WEAK SECRETS DETECTED IN PRODUCTION"

**Cause:** You're using demo/placeholder secrets

**Fix:** Generate new secrets with `./scripts/generate-secrets.sh`

### "Could not resolve account" (Bank Verification)

**Cause:** Invalid account number or bank code

**Fix:** 
- Verify the account number is 10 digits
- Confirm you selected the correct bank
- Test with a known valid account

### Build fails with "Missing environment variable"

**Cause:** Required variable not set

**Fix:** Check `.env.example` and ensure all required variables are in `.env.local`

---

## Support

For additional help:
- Check SETUP-INSTRUCTIONS.md for general setup
- Review implementation_plan.md for architecture details
- Contact: support@easysalesexport.com
