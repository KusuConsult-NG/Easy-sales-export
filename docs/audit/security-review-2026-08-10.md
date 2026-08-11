# Security review, 2026-08-10

`outstanding-work.md` listed security as never audited. This is the review so
far: what was found, what was checked and turned out clean, and what has not
been looked at.

The clean results are recorded as carefully as the findings. An audit that only
lists what it found reads as a complete picture of the system, and it never is.

## Findings, in the order they matter

### 1. A live Paystack secret key in public git history — NOT RESOLVED

Committed 2026-04-16, removed from the tree 2026-07-15, public repository
throughout. **Rotation is the only fix and it is still outstanding.** Full
detail in `secret-exposure-2026-08-10.md`.

### 2. Escrow could be funded by anyone, with any payment, repeatedly

`_confirmEscrowPaymentAction` marks an escrow "funded" — the record that a
buyer's money is secured and the seller may ship. Three defects compounded:

- `requireSession().catch(() => null)` — an auth failure produced null and
  execution carried on.
- `escrowId` was never compared to the caller, though `_createEscrowAction` in
  the same file has always checked `session.user.id !== data.buyerId`.
- The payment reference was never claimed. The only tests were "Paystack says
  this succeeded" and "the amount matches within ₦1" — both satisfied by *any*
  successful payment of that amount, including one already used.

Together: pay ₦5,000 once, then mark any number of unrelated ₦5,000 escrows as
funded, without being logged in.

Fixed: session required, buyer checked, reference through `claimPaymentOnce`,
and `pending → funded` is now a claim. Recorded as `escrow_funding`, not
`completed` — money into escrow is not revenue.

### 3. Vendors could write to records they did not own

Four functions in `vendor.ts` take an id and write to it. One checked ownership.
Any authenticated user could zero any vendor's stock, deactivate any product, or
set the status of any marketplace order — the last bypassing the
`claimStatusTransition` guards the integrity work installed, since it wrote
status directly.

`session.user.id` appears in all four. In three it is only written into the
audit row: recording *who* acted without deciding whether they *may*.

### 4. A webhook signature check the caller could opt out of

`if (qoreidSignature && secret)` — verification ran only when the caller chose
to send a signature. Also stopped logging the *expected* HMAC on mismatch, which
was a forgery oracle for anyone reading logs. Africa's Talking and Resend failed
open when their secret was unset; both now refuse.

## Checked and clean

Each of these was a specific hypothesis, tested and dismissed. They are recorded
so nobody re-derives them.

| Checked | Result |
|---|---|
| **XSS** | 3 `dangerouslySetInnerHTML` sites. `layout.tsx` renders static JSON-LD; the academy lesson sanitises with DOMPurify; the broadcast preview renders the admin's own typed content — self-XSS at worst. |
| **SSRF** | No `fetch()` takes a user-controlled host. The 85 non-literal-URL hits are all client-side calls to the app's own relative paths. |
| **Mass assignment** | 14 sites spread caller data into a write. **Every one is safe** — the security-relevant fields are set *after* the spread, or the spread object is built server-side. See the caveat below. |
| **Review moderation** | `approve`, `delete`, `suspend`, `moderate` all check `hasAdminPermission` or `hasRole`. |
| **MFA verification** | Rate limited via `withRateLimit`. Not brute-forceable. |
| **`/api/auth/register`** | Returns **404 in production** — dev-only, so unthrottled account creation is not reachable. |
| **KYC routes** | All four live routes require a session. `verify-id` is a 410 stub; the QoreID ID-check was removed. |
| **`/api/wallet/verify`** | Unauthenticated by design and correct: it trusts Paystack's verification rather than the caller, credits the `userId` from Paystack's own metadata, and is idempotent. An attacker can only re-trigger a payment that genuinely happened, to the person who made it. |
| **Committed env files** | All four are gitignored; none was ever committed. |

### The mass-assignment caveat

No vulnerability, but the reason there is none is thin. Safety rests on field
order in an object literal:

```js
const escrow = { ...data,              // caller-supplied
    status: "pending",                 // ← overwrites an injected status
    _version: 0 };
```

Reverse those two lines and it becomes privilege escalation — an escrow created
already funded, without payment. Fourteen sites depend on this, and nothing
enforces it. A schema validation layer (the codebase already uses Zod elsewhere)
would make the property structural rather than incidental.

`_createEscrowAction` now validates `amount` and `sellerId` at runtime, because
the parameter type is TypeScript and is erased at the wire.

### Rate limiting: 19 of 119 API routes

The raw number looks alarming and mostly is not. Every sensitive gap was checked
individually (above). What remains uncovered is admin routes, which sit behind
an admin role check, and cron routes behind `CRON_SECRET`.

Worth doing anyway, in this order: `/api/cooperatives/register`, then the admin
mutation routes. Rate limiting is defence in depth for endpoints that already
have authentication, not a substitute for it.

**One caution if anyone tightens this.** Nigerian mobile networks use CGNAT
heavily, so many legitimate users share an IP. A per-IP limit tuned as if IPs
were users will lock out real members — the `login` config's 5-per-15-minutes
would be too strict applied to registration.

## Not looked at

Named explicitly, because an audit that quietly skips things reads as an
all-clear — the same reasoning the fulfilment reconciler applies to payment
types it does not check.

- **RLS policy design.** Migration `004` is deny-all with no policies (Option A)
  and is still not applied to production. Until it is, the browser's public key
  can read and write every table. **This remains the largest unaddressed
  exposure in the system**, and it is configuration rather than code.
- ~~**Session and cookie handling**~~ — REVIEWED 2026-08-11, see below.
- ~~**File upload validation**~~ — FIXED 2026-08-11. `/api/upload` validated the
  Content-Type the *client* declared. `storage-admin.ts` had always read the
  magic bytes and failed closed, but only the marketplace path used it. The
  generic route behind `MasterUploader` — the one most uploads take — now calls
  the same validator.
- **The remaining ~18 IDOR candidates** from the detector sweep. Those triaged
  were admin actions using idioms the detector did not recognise; the rest were
  not individually read.
- ~~**Dependency vulnerabilities**~~ — CLEARED 2026-08-11. 24 advisories, 2
  critical and 9 high, down to 13 with **zero critical and zero high**. Both
  criticals were in the auth stack, including *"configuration errors can cause
  existence-based auth checks to fail open"* — and this codebase guards with
  `if (!sessionResult.session)` in roughly a hundred places.
- **Authorisation on server actions generally.** `action-security-audit.test.ts`
  enforces that action *files* import `requireSession`. It is file-level, so a
  file can import the guard and contain functions that never call it — which is
  exactly how the vendor defects survived. A per-function check would be worth
  building.


## Session, cookies and transport — reviewed 2026-08-11

Checked against the running production site rather than the source alone, since
the two can disagree and only one of them serves users.

| Checked | Result |
|---|---|
| **Session lifetime** | JWT, `maxAge` 8 hours, `updateAge` 1 hour. Appropriate for a platform holding money. |
| **Cookie flags** | `httpOnly`, `secure`, `sameSite: lax`. Live response confirms the `__Host-` and `__Secure-` prefixes, which also proves `NODE_ENV=production` really is set in the container — `secure` keys off it. |
| **CSRF** | `__Host-authjs.csrf-token` present and correctly prefixed. |
| **Session fixation** | Not applicable in the classic sense: the JWT strategy issues a fresh token at sign-in rather than promoting an anonymous session. |
| **HSTS** | `max-age=63072000; includeSubDomains; preload`. Two years, preloaded. |
| **Clickjacking** | `x-frame-options: DENY` *and* `frame-ancestors 'none'`. |
| **MIME sniffing** | `x-content-type-options: nosniff`. |
| **Admin route protection** | `/admin/layout.tsx` requires a session and checks `isAdmin`. The two admin-capable pages outside that tree — `/loans/approve` and `/escrow` — are cosmetic only: every action they call re-checks the role server-side, and the list actions return empty for non-admins. |

### The one real weakness: `script-src 'unsafe-inline'`

Everything above is in good order. This is not.

`'unsafe-inline'` in `script-src` removes most of what CSP is for. The XSS review
found three `dangerouslySetInnerHTML` sites and judged them safe — but "safe"
there means *no injection was found*, and CSP exists for the injection nobody
found.

Three inline scripts in `src/app/layout.tsx` are why it is there: a theme
no-flash guard, and two JSON-LD blocks. `<script type="application/ld+json">` is
still governed by `script-src`.

**The fix is nonces**, and it is not a small change:

1. the CSP is a static header in `next.config.ts`, and a nonce must be per
   request — so it has to move into `src/middleware.ts`
2. all three scripts must read that nonce via `headers()`
3. the static `script-src` must then drop `'unsafe-inline'`

**Deliberately not done here.** `src/middleware.ts` is the file that gates every
protected route, and the failure modes are a white screen (no script runs) or a
broken login — neither of which a build or a unit test detects. It needs a
browser against a running instance, which is not available while the deploy is
blocked.

Worth doing on the first working deploy, and cheap to verify once there is one:
load any page and check the console for CSP violations.
