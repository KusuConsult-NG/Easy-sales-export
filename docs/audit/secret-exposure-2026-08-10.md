# Secret exposure, 2026-08-10

Found while starting the security audit `outstanding-work.md` lists as never
done. The first thing checked was whether any credential had ever been
committed. One had.

## The one that matters

**A live Paystack secret key was public for just under four months.**

| | |
|---|---|
| File | `scripts/force-sync.js` |
| Committed | 2026-04-16 (`c767ff8e`) |
| Removed from the tree | 2026-07-15 (`a57f5e95`) |
| Still in git history | **yes** |
| Repository visibility | **public** |

Deleting the file did not remove it from history. `KusuConsult-NG/Easy-sales-export`
is a public repository, so the key was readable by anyone with a browser for the
whole period, and remains so until the key is rotated.

A Paystack secret key can initiate transfers, issue refunds, and read every
transaction on the account.

### What has to happen, and what cannot

**Rotate the key.** Paystack Dashboard → Settings → API Keys & Webhooks →
Generate New Secret Key, then update `PAYSTACK_SECRET_KEY` in Railway, in
`.env.production.local`, and in any GitHub secret.

**Then review the account** for transfers or refunds not initiated by the
platform since 2026-04-16.

Rewriting history is **not** the fix and is not recommended here. The key was
exposed the moment it was pushed; anyone could already have copied it, and a
rewrite would break every existing clone while changing nothing about that. It
is worth doing eventually for hygiene, and only after rotation.

## Everything else, triaged

Ten findings across history. Only the one above is a real credential.

| Finding | Verdict |
|---|---|
| RSA private key in `firebase-admin.ts`, `test-admin.js`, `scripts/verify-wave-member.js`, others | **One dummy key, repeated.** Verified by fingerprinting every distinct private-key body in history: there is exactly one, and it is the Firebase emulator placeholder. It authorises nothing. |
| `AIza…` Google/Firebase Web API key | **Public by design.** Shipped in the client bundle; it identifies the project, it does not authorise it. Security comes from Firebase rules and an HTTP-referrer restriction in the Google Cloud console — worth confirming that restriction exists. |
| `apikey: YOUR-ANON-KEY` in a runbook | Placeholder. |
| `test_api_key_12345` in an integration test | Fixture. |

**Environment files are clean.** `.env.local`, `.env.production.local`,
`.env.staging` and `.env.production.test` are all gitignored and none has ever
been committed.

## What changed in the code

**The emulator's dummy key is gone from source.** `firebase-admin.ts` carried a
1.7 KB `PRIVATE KEY` literal for local emulator use. It granted access to
nothing, but it is indistinguishable from a real leak to a scanner, to a
reviewer, and to anyone browsing a public repository. It now generates an
ephemeral RSA key at runtime, so there is nothing to leak and nothing to explain.

**CI scans history for credentials.** A `secret-scan` job runs `gitleaks` before
the build, with `fetch-depth: 0` — the leak that prompted this was in history
with a clean working tree, and a shallow clone would not have seen it.

`.gitleaks.toml` allowlists the ten triaged findings **by commit**, each with a
note on what it is and why it is dismissed. Two rules:

- The allowlist is narrow on purpose. A scanner that always fails is one nobody
  reads, and a broad allowlist is how it gets there.
- The Paystack commit is allowlisted so the check is green. **That does not
  resolve it.** Rotation does.

Verified both directions: a clean scan over 1,668 commits, and a probe file
containing a fake `sk_live_` key rejected by `gitleaks protect --staged`.

## Why this went unnoticed for four months

Nothing looked. There was no secret scanning in CI, and GitHub's own push
protection either is not enabled or did not cover this pattern — worth checking
in **Settings → Code security and analysis**, because it would have blocked the
push in April.

That is the same shape as the rest of this audit series: the guard did not fail,
it was absent, and absence is silent.

## Still open

- **Rotate the Paystack key.** Nothing else here matters until that is done.
- **Confirm the repository is intentionally public.** It holds a payments
  platform for a cooperative with 41,000 users. That may well be deliberate, but
  it should be a decision somebody has made rather than a default nobody
  revisited.
- **Enable GitHub secret scanning and push protection**, which stops the next
  one at the push rather than four months later.
- **Restrict the Google Maps / Firebase Web key by HTTP referrer** if it is not
  already.
- The rest of the security audit — authentication, authorisation, input
  handling, rate limiting — has not been done. This was the first check, not the
  whole review.
