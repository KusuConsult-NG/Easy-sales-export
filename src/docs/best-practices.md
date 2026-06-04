# Codebase Best Practices — Easy Sales Export

This document outlines key engineering patterns, rules, and best practices that developers must follow to prevent the re-emergence of common architectural and runtime bugs in the **Easy Sales Export** codebase.

---

## 1. Client-Side Firestore Gates

### Problem: Firebase Auth vs NextAuth Session timing lag
Client-side Firestore listeners (e.g. `onSnapshot`) require authenticated client credentials. In Next.js, `session` state from NextAuth loads independently from the Firebase Client SDK auth initialization. 

If a client-side Firestore listener executes before Firebase Auth is fully initialized, it will throw a Firestore permission error (permission-denied), causing infinite reload loops, missing data, or component crashes.

### Best Practice
Always gate your client-side Firestore listeners and reads using the [useFirebaseAuthed](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/hooks/useFirebaseAuthed.ts) hook.

```tsx
import { useFirebaseAuthed } from "@/hooks/useFirebaseAuthed";
import { subscribeToMessages } from "@/lib/firebase-listener";

export function ChatRoom({ userId }: { userId: string }) {
  // 1. Check if Firebase Client Auth matches the active NextAuth session user
  const isAuthed = useFirebaseAuthed(userId);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    // 2. Only subscribe when auth is fully synchronized
    if (!isAuthed) return;

    const unsubscribe = subscribeToMessages((data) => {
      setMessages(data);
    });

    return () => unsubscribe();
  }, [isAuthed]);

  if (!isAuthed) return <LoadingSpinner />;

  return <MessageList items={messages} />;
}
```

---

## 2. Firestore Case-Insensitivity (Case Normalization)

### Problem: Firestore String Queries are Case-Sensitive
Firestore queries do not support case-insensitive searches natively. Queries for `user@example.com` will fail to return a document stored as `User@example.com`. Case mismatches during registration, login, and background reconciliation scripts have historically caused database locks, double-charge issues, and onboarding failures.

### Best Practice
1. **Always normalize emails to lowercase** before querying or writing to Firestore collections.
2. **Normalize phone numbers** to E.164 standard format using the shared `normalisePhone` helper in [phone.ts](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/lib/phone.ts).

```ts
import { normalisePhone } from "@/lib/phone";

// WRITE PATH
const email = rawEmail.trim().toLowerCase();
const phone = normalisePhone(rawPhone) || rawPhone;

await db.collection("users").doc(userId).set({
  email,
  phone,
  // ...
});

// QUERY PATH
const userSnapshot = await db.collection("users")
  .where("email", "==", email)
  .get();
```

---

## 3. Decoupling Login Validation from Registration Validation

### Problem: Legacy User and PIN Lockouts
When anti-abuse measures or strict password requirements (e.g. minimum 8 characters, special character requirements) are added to Zod schemas, they must **not** be retrospectively enforced on the login endpoint. 

If they are, legacy users (who were onboarded under older rules like 6-character passwords or 6-digit admin onboarding PINs) will be locked out of their accounts because their existing credentials will fail schema validation.

### Best Practice
- Keep registration schemas ([registerSchema](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/lib/schemas.ts)) strict and up-to-date.
- Keep login schemas ([loginSchema](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/lib/schemas.ts)) relaxed:
  - Accept any valid email (standard email structure check).
  - Enforce a minimum password length of only 6 characters (to support legacy credentials).
  - Do not apply rules that reject symbols or restrict characters on login.

Verify registration schema changes in [schemas.test.ts](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/lib/__tests__/schemas.test.ts) to prevent regression.

---

## 4. Safe Server Action Firestore Serialization

### Problem: Firestore Timestamps crash Next.js Server Components
Next.js Server Actions and Server Components cannot serialize complex class instances (such as Firestore's `Timestamp` class or custom dates) directly when sending them to Client Components. Returning raw `doc.data()` objects containing these types causes a server serialization crash.

### Best Practice
Never return raw `.data()` directly to the client. Always process the data through [serializeValue](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/lib/firestore-serialize.ts), [serializeDoc](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/lib/firestore-serialize.ts), or [serializeDocs](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/lib/firestore-serialize.ts).

```ts
import { serializeDocs } from "@/lib/firestore-serialize";

export async function getExportRequests() {
  const snapshot = await db.collection("export_orders").get();
  
  // SAFE: converts Timestamps to ISO strings recursively
  return {
    success: true,
    data: serializeDocs(snapshot.docs),
  };
}
```

---

## 5. React Keys for Dynamic Lists

### Problem: React Key Bugs on Mutable Lists
Using array indexes (`key={index}`) as React component keys on dynamic, mutable lists (such as messaging rooms, notification alerts, or transaction tables) leads to component state corruption and rendering mismatches when items are deleted, prepended, or re-ordered.

### Best Practice
Always use a unique database identifier (e.g. `doc.id`, `message.id`, `transaction.id`) as the React key. Only use index-based keys if the list is strictly static and read-only.

```tsx
// ❌ BAD
{notifications.map((notif, index) => (
  <NotificationItem key={index} data={notif} />
))}

// ✅ GOOD
{notifications.map((notif) => (
  <NotificationItem key={notif.id} data={notif} />
))}
```
