
## Bug Audit Report â All 5 Modules

---

### 1. `/app/export/onboarding/page.tsx`

**BUG 1 â Session loading race condition:**
- `useSession()` is called as `const { data: session } = useSession()` â **`status` is NOT destructured at all.**
- The `useEffect` (lines 77â138) calls `checkExportStatusAction()` immediately on mount with **no `if (status === 'loading') return` guard.**
- Dependency array: `[router, session?.user?.id]`
- Since `status` isn't even imported from useSession, there is zero protection against firing while the session is still being hydrated.
- **VERDICT: BUGGY** â Missing the loading guard entirely. `checkExportStatusAction()` fires before session is confirmed.

**BUG 2 â Stuck isSubmitting on success path:**
- `setIsSubmitting(true)` is set at line 263.
- **Resubmit success branch (lines 273â279):**
  ```ts
  if (result.success) {
      showToast("Application resubmitted for review!", "success");
      router.push("/export/onboarding/pending");
  } else {
      showToast(`Failed to resubmit: ${result.error}`, "error");
      setIsSubmitting(false);
  }
  ```
  `setIsSubmitting(false)` is **NOT called** before `router.push()`. Only the else branch resets it.
- **Fresh submit success branch (lines 338â343):**
  ```ts
  if (result.success) {
      const userId = session?.user?.id;
      if (userId) { try { localStorage.removeItem(`export_draft_${userId}`); } catch { /* non-blocking */ } }
      showToast("Onboarding submitted successfully!", "success");
      router.push("/export/onboarding/pending");
  } else {
      ...
      setIsSubmitting(false);
  }
  ```
  Again, `setIsSubmitting(false)` is **NOT called** before `router.push()` on success.
- **VERDICT: BUGGY** â `isSubmitting` is never reset on either success path (resubmit or fresh submit). Button stays frozen if navigation is slow or the user presses back.

---

### 2. `/app/marketplace/onboarding/page.tsx`

**BUG 1 â Session loading race condition:**

<truncated 9962 bytes>