/**
 * Firebase client Auth shim.
 *
 * #363 signInWithEmailAndPassword RETURNED A SUCCESSFUL LOGIN FOR ANY INPUT.
 *
 * package.json points `firebase` at this directory, so an import of
 * `firebase/auth` lands here. In full, this file used to be:
 *
 *     module.exports = {
 *       getAuth: () => ({}),
 *       signOut: async () => {},
 *       signInWithCustomToken: async () => ({}),
 *       signInWithEmailAndPassword: async () => ({ user: { uid: "mock-uid" } })
 *     };
 *
 * That last line authenticates anybody as "mock-uid" without looking at the
 * password, and signOut() reports a successful sign-out having done nothing.
 * Neither is reached today — authentication runs through NextAuth against
 * Supabase, and the only importer of `firebase/auth` in the tree is
 * src/__tests__/integration/setup.ts, behind an `if ((global).testAuth)` that
 * nothing sets. So this is a trap rather than a live bypass: the first file to
 * import the obvious-looking name gets a login that always succeeds.
 *
 * Its sibling src/lib/shims/firebase/firestore.js was hardened for exactly
 * this reason and this one was missed. All four now throw, in the same style.
 */
function unsupported(name) {
  return () => {
    throw new Error(
      `[firebase/auth shim] ${name}() is not implemented. Firebase Auth is not ` +
      `used by this project — authentication is NextAuth over Supabase. ` +
      `Use auth() / signIn() / signOut() from "@/lib/auth" instead. ` +
      `See #363 in src/lib/shims/firebase/auth.js.`
    );
  };
}

module.exports = {
  getAuth: unsupported('getAuth'),
  signOut: unsupported('signOut'),
  signInWithCustomToken: unsupported('signInWithCustomToken'),
  signInWithEmailAndPassword: unsupported('signInWithEmailAndPassword'),
};
