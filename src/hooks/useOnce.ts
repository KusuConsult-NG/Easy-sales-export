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
 *   returns one today (all three payment callbacks checked), which is why this
 *   is a note rather than a change: making it correct would mean re-running
 *   `fn`, and re-running is exactly what this hook exists to prevent.
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
