/**
 * Firebase Admin Firestore shim.
 *
 * #363 THIS FILE IS A SECOND DATABASE ADAPTER, AND IT DISAGREES WITH THE REAL
 *      ONE. Its entry points now refuse; the classes below are kept, unchanged
 *      and unreachable, so nothing is lost if Firestore ever comes back.
 *
 * package.json points `firebase-admin` at this directory, so
 * `require("firebase-admin/firestore").getFirestore()` used to hand back a
 * fully working Supabase-backed adapter — a parallel to src/lib/supabase-db.ts
 * written against the same database and behaving differently in four ways that
 * corrupt data rather than fail:
 *
 *  1. IT IGNORES THE TABLE MAP. supabase-db.ts routes ten collections to
 *     dedicated tables via DEDICATED_TABLE_MAP (lib/supabase-table-map.ts).
 *     This adapter special-cases exactly one, `users`, and sends EVERYTHING
 *     else to document_collections. So a write to, say, marketplace_orders
 *     through this door creates a shadow row under
 *     collection_name = 'marketplace_orders' that the application never reads,
 *     while the real row in the dedicated table is left untouched — and a read
 *     through this door reports "does not exist" for a document that does.
 *
 *  2. update() IS AN UPSERT. It is `set(payload, { merge: true })`, so
 *     updating a document that is not there CREATES it. Real Firestore throws;
 *     supabase-db.ts documents the same call as a silent no-op. One method
 *     name, three behaviours.
 *
 *  3. THE WRITE BATCH ONLY IMPLEMENTS delete(). batch.set() and batch.update()
 *     are `undefined`, so a caller gets "this.batch.update is not a function"
 *     — a TypeError that reads like a bug in the caller.
 *
 *  4. Query HAS NO orderBy, limit, startAfter OR offset. Every paged scan
 *     written against it dies on the first line.
 *
 * And DocumentSnapshot.ref returns `new DocumentReference(null, this.id)` —
 * collectionName NULL. A write through a snapshot's own ref therefore lands in
 * document_collections under a null collection, or violates the NOT NULL
 * constraint, depending on which comes first.
 *
 * Nothing in the running application reaches this file: src/lib/firebase-admin.ts
 * re-exports supabaseDb and imports nothing from here. The only caller was
 * scripts/firebase-migrate.js, which is registered in package.json as
 * `npm run migrate:firebase`, claims a "Zero-Regression Guarantee", and hits
 * defects 3 and 4 above before it can write anything. See #363 in that file.
 *
 * getFirestore() and the Firestore class now throw, in the style of the
 * storage and messaging shims beside them, so the next caller is told where
 * the supported door is instead of quietly writing through the wrong one.
 * FieldValue, FieldPath, GeoPoint and AggregateField are left working: they
 * are inert value objects, several tests mock against them, and they cannot
 * write anything by themselves.
 */
try {
  global.WebSocket = require('ws');
} catch (e) {}

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

function unsupported(op) {
  throw new Error(
    `[firebase-admin/firestore shim] ${op} is not available — this shim is a ` +
    `SECOND database adapter that ignores DEDICATED_TABLE_MAP and would write ` +
    `shadow rows into document_collections. Use supabaseDb from ` +
    `"@/lib/supabase-db" (or getAdminDb() from "@/lib/firebase-admin", which ` +
    `returns it) instead. See #363 in src/lib/shims/firebase-admin/firestore.js.`
  );
}

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseServiceKey || supabaseAnonKey || 'placeholder',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  }
);

class GeoPoint {
  constructor(latitude, longitude) {
    this.latitude = latitude;
    this.longitude = longitude;
  }
}

class AggregateField {
  static sum(field) { return new AggregateField(); }
  static count(field) { return new AggregateField(); }
  static average(field) { return new AggregateField(); }
}

const FieldValue = {
  arrayUnion: (...args) => {
    // Return a transform sentinel
    return { _methodName: 'FieldValue.arrayUnion', _elements: args };
  },
  arrayRemove: (...args) => {
    return { _methodName: 'FieldValue.arrayRemove', _elements: args };
  },
  serverTimestamp: () => new Date().toISOString(),
  increment: (val) => {
    return { _methodName: 'FieldValue.increment', _operand: val };
  },
  delete: () => {
    return { _methodName: 'FieldValue.delete' };
  }
};

class DocumentSnapshot {
  constructor(id, data, exists = true) {
    this.id = id;
    this._data = data;
    this.exists = exists;
  }
  data() {
    return this._data;
  }
  get ref() {
    return new DocumentReference(null, this.id);
  }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
  }
}

class DocumentReference {
  constructor(collectionName, id) {
    this.collectionName = collectionName;
    this.id = id;
  }

  async get() {
    if (this.collectionName === 'users') {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', this.id);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        return new DocumentSnapshot(this.id, null, false);
      }
      const raw = data[0].raw_data || {};
      raw.id = this.id;
      raw.email = data[0].email;
      raw.roles = data[0].roles;
      return new DocumentSnapshot(this.id, raw, true);
    } else {
      const { data, error } = await supabase
        .from('document_collections')
        .select('*')
        .eq('collection_name', this.collectionName)
        .eq('id', this.id);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        return new DocumentSnapshot(this.id, null, false);
      }
      const raw = data[0].raw_data || {};
      raw.id = this.id;
      return new DocumentSnapshot(this.id, raw, true);
    }
  }

  async set(payload, options = {}) {
    const isMerge = options.merge === true;
    let existing = {};
    if (isMerge) {
      const snap = await this.get();
      if (snap.exists) {
        existing = snap.data();
      }
    }

    const merged = { ...existing };
    for (const [k, v] of Object.entries(payload)) {
      if (v && v._methodName === 'FieldValue.arrayUnion') {
        const arr = Array.isArray(merged[k]) ? [...merged[k]] : [];
        for (const el of v._elements) {
          if (!arr.includes(el)) arr.push(el);
        }
        merged[k] = arr;
      } else if (v && v._methodName === 'FieldValue.arrayRemove') {
        const arr = Array.isArray(merged[k]) ? [...merged[k]] : [];
        merged[k] = arr.filter(el => !v._elements.includes(el));
      } else if (v && v._methodName === 'FieldValue.increment') {
        merged[k] = (typeof merged[k] === 'number' ? merged[k] : 0) + v._operand;
      } else if (v && v._methodName === 'FieldValue.delete') {
        delete merged[k];
      } else if (v instanceof Date) {
        merged[k] = v.toISOString();
      } else {
        merged[k] = v;
      }
    }

    // Write to Supabase
    if (this.collectionName === 'users') {
      const row = {
        id: this.id,
        email: merged.email ? merged.email.toLowerCase() : null,
        roles: merged.roles || [],
        raw_data: merged,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('users').upsert(row);
      if (error) throw new Error(error.message);
    } else {
      const row = {
        id: this.id,
        collection_name: this.collectionName,
        raw_data: merged,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('document_collections').upsert(row);
      if (error) throw new Error(error.message);
    }
  }

  async update(payload) {
    return this.set(payload, { merge: true });
  }

  async delete() {
    if (this.collectionName === 'users') {
      const { error } = await supabase.from('users').delete().eq('id', this.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from('document_collections')
        .delete()
        .eq('collection_name', this.collectionName)
        .eq('id', this.id);
      if (error) throw new Error(error.message);
    }
  }
}

class Query {
  constructor(collectionName, filters = []) {
    this.collectionName = collectionName;
    this.filters = filters;
  }

  where(field, op, value) {
    return new Query(this.collectionName, [...this.filters, { field, op, value }]);
  }

  async get() {
    const isUsers = this.collectionName === 'users';
    const tableName = isUsers ? 'users' : 'document_collections';
    
    let query = supabase.from(tableName).select('*').order('id');
    if (!isUsers) {
      query = query.eq('collection_name', this.collectionName);
    }
    
    for (const f of this.filters) {
      const field = f.field;
      const op = f.op;
      const value = f.value;
      
      const isDocumentId = (field && typeof field === 'object' && field._methodName === 'FieldPath.documentId') || field === '__name__' || field === 'id';
      const isNative = isUsers && ['id', 'email', 'roles', 'created_at', 'updated_at'].includes(field);
      
      let columnPath;
      if (isDocumentId) {
        columnPath = 'id';
      } else if (isNative) {
        columnPath = field;
      } else {
        const parts = typeof field === 'string' ? field.split('.') : [String(field)];
        if (parts.length === 1) {
          columnPath = `raw_data->>${JSON.stringify(parts[0])}`;
        } else {
          const intermediate = parts.slice(0, -1).map(p => `->${JSON.stringify(p)}`).join('');
          columnPath = `raw_data${intermediate}->>${JSON.stringify(parts[parts.length - 1])}`;
        }
      }
      
      if (op === '==') {
        if (value === null) {
          query = query.is(columnPath, null);
        } else {
          query = query.eq(columnPath, value);
        }
      } else if (op === '!=') {
        if (value === null) {
          query = query.not(columnPath, 'is', null);
        } else {
          query = query.neq(columnPath, value);
        }
      } else if (op === '<') {
        query = query.lt(columnPath, value);
      } else if (op === '<=') {
        query = query.lte(columnPath, value);
      } else if (op === '>') {
        query = query.gt(columnPath, value);
      } else if (op === '>=') {
        query = query.gte(columnPath, value);
      } else if (op === 'in') {
        query = query.in(columnPath, Array.isArray(value) ? value : [value]);
      } else if (op === 'array-contains') {
        if (isUsers && field === 'roles') {
          query = query.contains('roles', [value]);
        } else {
          // JSONB array contains
          const parts = typeof field === 'string' ? field.split('.') : [String(field)];
          const arrPath = parts.length === 1
            ? `raw_data->${JSON.stringify(parts[0])}`
            : `raw_data${parts.slice(0, -1).map(p => `->${JSON.stringify(p)}`).join('')}->${JSON.stringify(parts[parts.length - 1])}`;
          query = query.filter(arrPath, 'cs', JSON.stringify([value]));
        }
      }
    }
    
    // Auto-paginated batch retrieval to bypass 1,000-row select capping
    const allData = [];
    let fetchedSoFar = 0;
    const limitVal = 999999;
    
    while (fetchedSoFar < limitVal) {
      const batchLimit = 1000;
      const rangeStart = fetchedSoFar;
      const rangeEnd = rangeStart + batchLimit - 1;
      
      const { data, error } = await query.range(rangeStart, rangeEnd);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      
      allData.push(...data);
      fetchedSoFar += data.length;
      
      if (data.length < batchLimit) break;
    }
    
    const docs = allData.map(row => {
      const raw = row.raw_data || {};
      raw.id = row.id;
      if (isUsers) {
        raw.email = row.email;
        raw.roles = row.roles;
      }
      return new DocumentSnapshot(row.id, raw, true);
    });
    
    return new QuerySnapshot(docs);
  }
}

class CollectionReference extends Query {
  constructor(name) {
    super(name);
  }
  doc(id) {
    return new DocumentReference(this.collectionName, id);
  }
}

class WriteBatch {
  constructor() {
    this.operations = [];
  }
  delete(ref) {
    this.operations.push({ type: 'delete', ref });
  }
  // #363 These two were absent, so a caller got "batch.update is not a
  // function". Present and refusing, so the message names the real door.
  set() {
    unsupported('batch.set()');
  }
  update() {
    unsupported('batch.update()');
  }
  async commit() {
    for (const op of this.operations) {
      if (op.type === 'delete') {
        await op.ref.delete();
      }
    }
  }
}

/**
 * #363 The three doors into the adapter above. All three refuse.
 *
 * The bodies they used to have are kept verbatim in the comments beside each,
 * because the classes they reach are still here and still correct for a real
 * Firestore — what is wrong is using them against THIS database.
 */
class MockFirestore {
  collection(_name) {
    // was: return new CollectionReference(_name);
    unsupported('getFirestore().collection()');
  }
  doc(_path) {
    // was: split the path and return new DocumentReference(collection, id)
    unsupported('getFirestore().doc()');
  }
  batch() {
    // was: return new WriteBatch();
    unsupported('getFirestore().batch()');
  }
}

const firestoreInstance = new MockFirestore();

module.exports = {
  GeoPoint,
  AggregateField,
  FieldValue,
  Query,
  Firestore: MockFirestore,
  getFirestore: () => firestoreInstance,
  FieldPath: {
    documentId: () => 'id'
  }
};
