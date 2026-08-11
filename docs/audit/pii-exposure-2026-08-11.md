# 41,105 user records in a public repository

**Found 2026-08-11. This is more serious than the Paystack key, and it is not
fixed by this commit.**

## What is exposed

`exports/all_users.xlsx` — 4.4 MB, **41,106 rows** (41,105 users plus a header),
with these columns:

| | |
|---|---|
| User ID | Full Name |
| **Email** | **Phone** |
| State | LGA |
| Roles | Academy Status |
| Cooperative Status | WAVE Status |
| Farm Nation Status | Export Status |
| Created At | |

Alongside it, `exports/users_by_state/` holds **40 more spreadsheets**, one per
state, the same data sliced — Kaduna 2,565 users, Plateau 2,964, Bauchi 1,055,
and an "Unknown" file with 21,796.

The repository `KusuConsult-NG/Easy-sales-export` is **PUBLIC**. Anyone could
clone it and read every record. No credentials, no exploit, no vulnerability to
chain — `git clone` was sufficient.

## What this commit does, and what it does not

**Does:** removes `exports/` from the working tree and the index, and adds
`exports/`, `*.xlsx` and `*.csv` to `.gitignore` so it cannot recur by accident.

**Does NOT:** remove the files from git history. They remain in every commit that
contained them, in every existing clone, and are still retrievable from GitHub's
API by anyone who knows the object hash — deleting a file from the tip does
nothing for the objects behind it. This is the same trap as the Paystack key,
which was removed from the tree on 2026-07-15 and stayed readable in history.

**Deleting the file is necessary and it is not the remediation.**

## What actually remediates it, in order

1. **Make the repository private — today.**
   This is the single highest-value action and takes one click. It stops
   further collection immediately, while history is dealt with. Check first
   whether Railway deploys via the GitHub integration (which keeps working on a
   private repo) or an anonymous clone (which will not).

2. **Purge the objects from history**, with `git filter-repo` or the GitHub
   support path, then force-push and require every collaborator to re-clone.
   Rewriting shared history is disruptive and is a decision for the repository
   owner, which is why it is not done here.

3. **Treat it as a reportable personal data breach.**
   Nigeria's Data Protection Act 2023 covers name, email and phone as personal
   data. 41,105 data subjects, publicly available, unknown duration. The NDPA
   notification window is short. This is a legal question, not an engineering
   one, and it needs advice today rather than after the history purge.

4. **The exposure window is known: 52 days.**
   Added **2026-06-20** in commit `a51213fa`, still present at HEAD on
   2026-08-11. One commit introduced all 41 files. Whether the repository was
   public for the whole of that window needs confirming from the repo's
   visibility history, but it is public now and there is no record of it having
   been changed.

5. **Assume the data is copied.** A public repository with 41,105 contact
   records is exactly what scrapers collect. Plan on the basis that it is
   already held elsewhere, and consider what that means for the users in it —
   the phone numbers alone are a ready-made list for SMS fraud aimed at people
   who have accounts with a financial platform.

## Also removed here

`.turbo/` — 66 files of Turborepo build cache were tracked. Sampled for
credentials and none found, but build caches contain compiled output and can
contain environment values, and they have no business in version control.

## How it was missed until now

Every audit this week scanned source: `src/app/actions`, `src/app/api`,
`src/lib`, `src/infrastructure`. The secret-scanning work in
`secret-exposure-2026-08-10.md` looked for credential patterns in code and
history. None of it enumerated **tracked non-source files**, so a 4.4 MB
spreadsheet of user data sat outside every tool that was pointed at the problem.

`outstanding-work.md` even referenced this file — "Download
`exports/all_users.xlsx` … 41,105 user records. Your safety net if data is
missing" — as a *recovery asset*. It was read as a backup and never as an
exposure, by me included, until the file listing was examined directly rather
than the code.

**The lesson is narrower than "audit everything": an audit scoped to source
reports on source, and says nothing about the repository.** `git ls-files` was
the command that found this, and it should have been the first one run.
