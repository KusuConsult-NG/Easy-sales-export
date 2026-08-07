const db = require('../../supabase-client-db');

/**
 * Firebase client Firestore shim.
 *
 * Everything real is re-exported from supabase-client-db. The two writers
 * below used to be stubs — addDoc returned `{ id: "mock-id" }` and updateDoc
 * returned `{}`, neither writing anything, both reporting success. Any code
 * that imported them would silently lose every write.
 *
 * They now throw. supabase-client-db implements no client-side writes at all,
 * so failing loudly is the only honest behaviour: writes belong in a Server
 * Action against supabase-db. The same applies to setDoc/writeBatch/
 * runTransaction/serverTimestamp, which this module has never exported —
 * importing them yields undefined and fails at the call site.
 */
function unsupported(name) {
  return () => {
    throw new Error(
      `[firebase/firestore shim] ${name}() is not implemented. ` +
      `Client-side writes are not supported — perform this write in a Server Action ` +
      `using supabaseDb from "@/lib/supabase-db".`
    );
  };
}

module.exports = {
  ...db,
  addDoc: unsupported('addDoc'),
  updateDoc: unsupported('updateDoc'),
  setDoc: unsupported('setDoc'),
  writeBatch: unsupported('writeBatch'),
  runTransaction: unsupported('runTransaction'),
};
