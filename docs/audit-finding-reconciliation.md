# Reconciling two audit sequences

Two defect audits ran against this repository at the same time, on branches that
never saw each other:

| branch | commits | numbers used |
| --- | --- | --- |
| `claude/easy-sales-export-audit-voajzc` | ~100 | #151–#344 |
| `claude/academy-email-bugs-6iktdu` | 11 | #227–#256 |

Both allocate finding numbers from one imagined counter, so the overlap is not a
coincidence to be smoothed over — **ten numbers name two different defects
each**. This file is the map, and it exists because the ambiguity is already in
pushed history and history is not being rewritten to hide it.

## Which meaning wins

The `-voajzc` sequence keeps its numbers. It is the larger set, and — the
deciding fact — it is the one that **cites its numbers inside source files**:
75 comment citations of the ten contested numbers across the tree, written next
to the code they explain.

The `academy-email-bugs` sequence cites none of the contested numbers in any
file. Its ten collisions live only in commit subjects, so renumbering them costs
nothing and moves nothing that a future reader will grep for.

Verified rather than assumed:

```
$ git diff origin/main..claude/academy-email-bugs-6iktdu | grep '^+' | grep -oE '#[0-9]{2,3}\b' | sort -u
#49 #207 #209 #210 #216 #225 #228 #343
```

Every one of those is either a backward reference to a finding already on `main`
(#49, #207, #209, #210, #216, #225), this branch's own uncontested number
(#228), or a correctly attributed reference to the other sequence (#343). No
contested number appears in a file on this branch.

## The map

`academy-email-bugs` findings are renumbered to **#345–#354**, continuing past
the other sequence's highest allocation (#344). Left column is what the commit
subject says; right column is what the finding should be called from now on.

| was | now | the finding (academy-email-bugs) | what the other sequence means by the old number |
| --- | --- | --- | --- |
| #240 | **#345** | `ACADEMY_CERTIFICATE_MIN_PROGRESS` was introduced and then not used by the page that gates on progress | the client-verify half of a cooperative claim, and its lost-claim sync |
| #245 | **#346** | `getLandListings()` with no filter returned the review queue to the public | a kill switch that failed OPEN on a database error |
| #246 | **#347** | `verified` expanded to a hardcoded `['verified','approved']`, so `available` listings were invisible inventory | (part of #246–#248) chatbot admin writes that reported success without writing |
| #248 | **#348** | the sixth blind land status write, the one the converted five left behind | (part of #246–#248) as above |
| #249 | **#349** | an edited listing returned to `pending_verification` carrying its old `verifiedAt`/`verifiedBy` | (part of #249–#251) every automated payout could pay twice |
| #251 | **#350** | the export opportunity list inferred "has more" from a full page | (part of #249–#251) as above |
| #252 | **#351** | two export cache tags were declared and never written to, so a closed window served for an hour | **every `revalidateTag` call in this codebase threw** |
| #253 | **#352** | the maximum-loan ceiling passed everything | (part of #253–#254) one commission rate, and a payout that ignored its own escrow |
| #254 | **#353** | the double-lending check matched nothing | (part of #253–#254) as above |
| #256 | **#354** | the admin was never told why an approval was refused | a cast hid one `revalidateTag` from the ratchet built for it |

Uncontested and unchanged: #227–#239, #241–#244, #247, #250, #255.

Note the near-miss at #252: both sequences used it for a cache-invalidation
finding in the same week, about different tags in different files. That is the
kind of collision that reads as a cross-reference and is not one.

## Merging the eight files both branches touched

| file | resolution |
| --- | --- |
| `actions/academy/_ac_catalog.ts` | **both.** `-voajzc` adds retirement-on-delete and an `enrolledCount` seed; `academy-email-bugs` changes the two readers to pass the whole registration. Different regions. |
| `actions/academy/_ac_enrollment.ts` | **both.** `-voajzc` adds one `isRetired` filter; `academy-email-bugs` rewrites application selection. Different regions. |
| `actions/admin/_marketplace.ts` | **take `-voajzc`'s cache and email lines, keep `academy-email-bugs`' `.all()`.** Their `updateTag` conversion is the #252 fix (see below); the unbounded user-list query is a different region. |
| `actions/course-actions.ts` | **direct conflict, already resolved here.** Both gave `getUserEnrolledCourses` a payload key — `data.enrollments` vs `data.courses`. There is no production caller to settle it, so this branch now publishes both names for the same array, and a test pins that they stay the same rows. Five assertions in their `course-actions-behaviour.test.ts` pass against it unchanged. |
| `actions/cooperative/_coop_registration.ts` | **both**, then re-run: two independently written `cooperative-registration-behaviour.test.ts` files exist. Same name, different tests. One must be renamed at merge. |
| `actions/land-actions.ts` | **take `academy-email-bugs`.** See below. |
| `__tests__/unit/land-listing-visibility.test.ts` | **converged.** Both branches now assert the same guard; see below. |
| `__tests__/unit/cooperative-registration-behaviour.test.ts` | **rename one.** Created independently under the same path. |

### land-actions.ts: the fix that is a superset

`-voajzc` #340 added an authorization gate to `getLandListings` — asking for a
non-public `status` requires an admin. Correct as far as it goes, and it leaves
the hole open. On that branch today:

```ts
const wantsNonPublic = requestedStatus !== undefined && !PUBLIC_LAND_STATUSES.includes(requestedStatus);
if (wantsNonPublic) { /* ...require admin... */ }

if (filters?.status) { /* ...the only place a status predicate is applied... */ }
```

Call it with **no arguments** and `wantsNonPublic` is false, so no session is
required — and no status predicate is applied either, because that is inside
`if (filters?.status)`. An unauthenticated `getLandListings()` returns the 50
newest listings of *every* status, full documents, including
`verificationNotes`, `rejectionReason` and the owner's email. The gate refuses
the front door and leaves the wall open.

`academy-email-bugs` #346 decides the status set once, defaulting to
`PUBLIC_LAND_STATUSES`, and strips internal fields from the browse feed. It
subsumes #340 rather than competing with it.

### The one fix that went the other way

`-voajzc` #265 found that `verifyLandListing`'s guard was
`roles.includes('admin') || roles.includes('super_admin')` while
`land:verify_listings` is granted to super_admin, admin **and**
farm_nation_admin — the module that owns the queue. Eleven other call sites ask
for the permission by name; that guard was the twelfth and disagreed. A
farm_nation_admin could approve through `/api/admin/farm-nation/approve-land`
and was refused by the action.

`academy-email-bugs` rewrote that function's status transition and left the
guard alone. It now names the permission, so both branches agree and the merge
has nothing to choose between.

### What this branch is deliberately NOT fixing

`-voajzc` #252 proved that 15 `revalidateTag(tag, "page")` call sites **throw**.
`"page"` is not one of the seven profiles Next ships, and
`next/dist/server/revalidation-utils.js:111` throws `E873` on an unknown one —
inside `executeRevalidates`, in the `finally` of the Server Action wrapper,
after the action's own write has committed. Verified independently here:

```
$ node -e "const {defaultConfig}=require('next/dist/server/config-shared'); \
    console.log(Object.keys(defaultConfig.cacheLife||{}).join(' '))"
default seconds minutes hours days weeks max
```

Those 15 sites are still live on this branch, because it branched from `main`
and the fix is on `-voajzc`. Fixing them here a second time would produce a
merge conflict across 15 sites to reach a destination that already exists.
**Take `-voajzc`'s version.**

The two `revalidateTag(tag, "max")` calls this branch *adds* in
`actions/export/_ex_windows.ts` are not part of that class: `"max"` is a real
profile, and `updateTag` is deliberately not used there because the admin
closing an export window is not the person browsing the public feed —
stale-while-revalidate is the wanted shape, and the Next docs name `"max"` the
recommended form for exactly that.

## Whoever merges second

1. Renumber per the table above if you are merging `academy-email-bugs`; the
   `-voajzc` numbers do not move.
2. Rename one `cooperative-registration-behaviour.test.ts`.
3. Take `-voajzc` for the `revalidateTag` class and for `_ac_catalog` /
   `_ac_enrollment` retirement; take `academy-email-bugs` for `getLandListings`.
4. Run the full suite. Both branches' tests are behavioural and execute the code
   they describe, so a lost fix shows up as a failure rather than as silence.
