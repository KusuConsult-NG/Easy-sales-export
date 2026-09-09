import { useEffect, useRef } from 'react';

/**
 * useOnce — Runs `fn` exactly once per component mount, even in React 18 Strict Mode.
 *
 * React 18 Strict Mode intentionally mounts→unmounts→remounts every component in
 * development to surface side-effect bugs. Any useEffect that makes a network call,
 * verifies a payment, or submits a form will fire TWICE without this guard.
 *
 * Usage:
 *   useOnce(() => {
 *     verifyPayment(reference);
 *   });
 *
 *   #418 THE HEADER USED TO SAY THE CALLBACK FIRES ON THE SECOND MOUNT.
 *
 *   It does not. The `called` ref persists across React 18's probe unmount —
 *   it is the same component instance — so the sequence is: effect runs and
 *   `fn` fires, cleanup runs, effect runs again and returns immediately. The
 *   callback fires on the FIRST run; the second is the no-op.
 *
 *   The guarantee callers need is unchanged and still holds: exactly once. What
 *   was wrong was the explanation, on a hook that guards three payment
 *   verifications, where being precise about which run fires is the whole point.
 *
 *   ONE THING TO KNOW BEFORE RETURNING A CLEANUP FROM `fn`. It is returned from
 *   the FIRST effect run, so React's probe unmount tears it down — and the
 *   second run returns nothing, so it is never re-established. No caller
 *   returns one today (all payment callbacks checked), which is why this
 *   is a note rather than a change: making it correct would mean re-running
 *   `fn`, and re-running is exactly what this hook exists to prevent.
 *
 *   #568 AND THE COUNT IN THAT NOTE WAS STALE, WHICH MATTERED.
 *
 *   It said "all three payment callbacks checked". There are SIX — academy,
 *   cooperatives, marketplace, export, export/buyer/cart and farm-nation — and
 *   only three of them used this hook. THE FIX HAD REACHED HALF THE DOORS, and
 *   the hook's own header asserted a completeness that made the other three
 *   invisible: anyone reading it would conclude the platform's payment
 *   callbacks were covered.
 *
 *   The first draft of #568 said SEVEN here, having counted the cooperative
 *   callback twice — once for itself and once for the dedicated domain it also
 *   serves. The test that now walks the directory caught it. That is the point:
 *   a number nothing counts drifts, and it drifts for whoever writes it next
 *   just as readily as it did for whoever wrote it first.
 *
 *   A number in a comment is a claim, and this one was checkable and wrong. The
 *   remaining four are converted in #568, and the claim is now about the class
 *   rather than a count that goes stale the next time somebody takes a payment.
 */
export function useOnce(fn: () => void | (() => void)): void {
  const called = useRef(false);
  useEffect(() => {
    if (called.current) return;
    called.current = true;
    return fn();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
