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
 * The callback fires on the SECOND mount (the real one), not the first (the probe mount).
 * This is the correct behavior for side effects that must not be undone.
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
