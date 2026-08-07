/**
 * Firebase Admin Storage shim.
 *
 * No Firebase Storage bucket is provisioned for this project — file storage is
 * Cloudinary (src/lib/storage-admin.ts, src/app/api/upload/route.ts).
 *
 * This shim previously returned a bucket whose save/delete resolved without
 * doing anything and whose makePublic/getSignedUrl did not exist at all. Upload
 * callers therefore "stored" a file, got no error, and then crashed on the
 * missing method — or, for deletes, silently kept the asset forever while the
 * database row said it was gone.
 *
 * Every operation now throws with a pointer to the supported path, so a
 * regression surfaces at the call site instead of as phantom data.
 */
function unsupported(op) {
  throw new Error(
    `[firebase-admin/storage shim] bucket.${op}() is not available — ` +
    `Firebase Storage is not provisioned for this project. ` +
    `Use uploadFileToStorage() from "@/lib/storage-admin" (Cloudinary) instead.`
  );
}

class MockBucket {
  constructor(name) {
    this.name = name;
  }
  file(path) {
    return {
      name: path,
      save: async () => unsupported('file().save'),
      delete: async () => unsupported('file().delete'),
      exists: async () => unsupported('file().exists'),
      makePublic: async () => unsupported('file().makePublic'),
      getSignedUrl: async () => unsupported('file().getSignedUrl'),
      publicUrl: () => unsupported('file().publicUrl'),
    };
  }
}

class MockStorage {
  bucket(name) {
    return new MockBucket(name);
  }
}

module.exports = {
  getStorage: () => new MockStorage()
};
