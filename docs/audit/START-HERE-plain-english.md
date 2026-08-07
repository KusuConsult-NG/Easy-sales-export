# Start Here — what's wrong and what to do

Written for a non-technical reader. The detailed engineering write-up is in
`data_layer_integrity_audit.md`; you don't need to read it, but a developer will.

---

## The short version

Your app was rebuilt from one database (Firebase) onto another (Supabase) by
writing a translation layer between them. The translation layer had bugs. The
programming language's error checker couldn't see them, so the app *looked*
healthy — it compiled, it built, it deployed — while specific features were
quietly broken.

That's why fixing one thing seemed to break another. Nobody was breaking
things; things were already broken, and each fix just revealed the next one.

I found and fixed 20 defects. There are 21 more that I've documented but not
fixed, because they need either a decision from you or a database change that
must be tested before it goes live.

---

## Do these three things this week

### 1. Save your deleted users' details — today

There's a background job that permanently deletes accounts 30 days after
they're marked for deletion. It deletes the person's data, then their login.
**The second half has never worked**, because it was calling the old Firebase
system that no longer exists.

That's accidentally good news. It means the **email address and name of every
account that job has ever deleted are still sitting in your database**, in a
place called `auth.users`. Right now that's your best chance of getting deleted
customer records back.

I fixed the deletion so it works properly — but I deliberately left it switched
**off**, because turning it on would erase exactly the data you might need.

**What to do:** Log in to Supabase → **Authentication** → **Users** → **Export**.
Save that file somewhere safe. Do it before anything else.

### 2. Check whether you have any backups at all

Your written backup plan (`docs/backup_strategy.md`) describes backing up
Firebase. **You don't use Firebase anymore.** If that's the plan you were
relying on, you may have no backups of your live data.

**What to do:** Supabase → **Database** → **Backups**. Then tell me what you see.

- If you're on the **Free** plan, there are no backups. Upgrading to Pro turns
  on daily backups and point-in-time recovery — but only from that moment
  onward. It cannot recover the past.
- If you're on **Pro**, backups are typically kept ~7 days. **That window is
  expiring while you decide.** If you need to restore something, act now.

### 3. Close the security hole

Anyone who visits your website can currently read and write your **entire
database** — every user, every wallet, every transaction — without logging in.
This isn't a theory; the key that allows it is published inside your website's
code, which is normal and expected. What's missing is the database-side rule
that limits what that key can do.

This is the most serious finding in the whole audit.

I've written the fix (`supabase/migrations/004_enable_row_level_security.sql`)
but **deliberately not applied it**, because switching it on carelessly will
take your dashboard offline. It needs a developer to test on a copy first.

---

## What I fixed (already done)

You don't need to understand these. They're listed so you can see the shape of
the problem.

| What was broken | What users experienced |
|---|---|
| Cooperative contribution payments | Members were charged by Paystack, then verification failed every time |
| Cooperative balance & membership pages | Failed to load |
| All file uploads on the server | Product photos, certificates and export documents never saved |
| Saving new records | Silently did nothing — the app said "saved" and nothing was written |
| Member/savings counters | Corrupted instead of counting up |
| Admin "total transactions" figure | Showed a sum of money instead of a count |
| All financial totals | Undercounted once past 1,000 records |
| Unread message badge | Counted every conversation on the platform, and downloaded them to every browser |
| The notification bell | Crashed the page whenever you had a notification |
| "Recent Orders" on seller dashboard | Showed five random orders |
| Login, registration, password reset | Depended on a Firebase password that no longer does anything — deleting it would have broken all sign-ins |
| Push notifications | Reported "sent" for every notification; none were ever delivered |
| Deleted users' logins | Never actually removed |

I also got your automated tests running (they were failing to start) and added
new ones so these specific bugs can't come back unnoticed. **All 323 tests
pass.**

---

## What still needs a decision from you

I stopped on these because guessing would change how your business works.

### Loans — the most urgent

There are **three different loan systems** in your app, all saving to the same
place, all with different rules:

- One charges the rate you set per loan product. **It has a bug that would
  charge roughly 12× the advertised rate.** Nothing currently uses it, but it
  is still switched on and reachable.
- One always charges 10% per year regardless of what you configured, and
  ignores your loan products entirely.
- One — **the one your customers actually use** at `/loans/apply` — records no
  interest rate and no repayment period at all. **Those borrowers get an empty
  repayment schedule: no instalments, no due dates, nothing to pay back.**

They also disagree on how much someone can borrow, by a factor of six.

**I need you to tell me:** which of these is your real loan product, what
interest you actually intend to charge, and how much a member should be able to
borrow relative to their savings. Then I'll make the code match and switch off
the others.

### Push notifications

Nothing has ever been delivered. To restore them you need to choose and pay for
a notification service. Tell me if you want this and I'll wire it up.

### Everything else

Documented in the engineering write-up: making money operations safe against
double-charging, stopping pages from loading entire tables, and removing unused
code. None are emergencies; all should be scheduled.

---

## The honest bit

You have a live app handling real money and real customer data, and right now:

- there's no confirmed backup,
- the database is open to the public internet,
- and there's no developer on it.

I can find problems and write fixes, and I've done both. But I can't log in to
your Supabase account, I can't deploy, and I can't verify a change against real
customer data. Someone has to.

**My honest recommendation:** get a developer — even part-time, even for two
weeks. Hand them `data_layer_integrity_audit.md`. The work is written up,
prioritised, and the risky parts are flagged. It's a few days of work for
someone competent, not a rebuild.

In the meantime, do the three things at the top of this page. The first two are
just clicking around a dashboard, and the first one is time-sensitive.

---

## Where my work is right now

Everything I've done is committed but **not yet uploaded to GitHub** — this
session doesn't have permission to push. A developer can retrieve it, or you
can grant write access and I'll push it.

Nothing I changed is deployed. Your live site is exactly as it was.
