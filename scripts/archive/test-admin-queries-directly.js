const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

const db = admin.firestore();

async function testUsersSearch(searchString) {
  console.log(`\n\n=================== TESTING USERS SEARCH for "${searchString}" ===================`);
  
  let query = db.collection('users');
  let hasUnindexedFilter = false;

  const s = searchString.trim();
  // Exact match email
  if (s.includes("@")) {
    query = query.where("email", "==", s.toLowerCase());
  } else if (/^[\d+]+$/.test(s) && s.length > 5) {
    query = query.where("phone", "==", s);
    hasUnindexedFilter = true;
  }

  if (!hasUnindexedFilter) {
    query = query.orderBy("createdAt", "desc");
  }

  const FETCH_LIMIT = 5000;
  query = query.limit(FETCH_LIMIT);

  console.log("Firestore Query object (users): built successfully. Fetching...");
  const snapshot = await query.get();
  console.log(`Fetched docs count from Firestore: ${snapshot.docs.length}`);

  const users = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.fullName || data.name || data.displayName || data.firstName || "Unknown",
      firstName: data.firstName || "",
      lastName: data.lastName || "",
      email: data.email || "",
      phone: data.phone || "",
      state: data.address?.state || data.state || "",
      lga: data.address?.lga || data.lga || "",
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt ? new Date(data.createdAt).toISOString() : new Date(0).toISOString()),
      serviceRegistrations: data.serviceRegistrations || {},
      roles: data.roles || []
    };
  });

  console.log("Mapping complete. deduplicating email...");
  const emailMap = new Map();
  for (const u of users) {
    if (!u.email) continue;
    const key = u.email.toLowerCase().trim();
    const existing = emailMap.get(key);
    if (!existing) {
      emailMap.set(key, u);
    }
  }
  const deduplicatedUsers = Array.from(emailMap.values());
  console.log(`Deduplicated count: ${deduplicatedUsers.length}`);

  // Local filtering (the exact code in admin.ts)
  const searchLow = s.toLowerCase();
  const filteredUsers = deduplicatedUsers.filter(user => {
    const searchString = [
        user.name,
        user.firstName,
        user.lastName,
        user.email,
        user.phone,
        user.state,
        user.lga
    ].filter(Boolean).map(String).join(" ").toLowerCase();
    return searchString.includes(searchLow);
  });

  console.log(`Filtered Users after search match: ${filteredUsers.length}`);
  if (filteredUsers.length > 0) {
    console.log("Found matches in Users:");
    filteredUsers.forEach(u => console.log(` - ID: ${u.id}, Name: ${u.name}, Email: ${u.email}`));
  }
}

async function testCoopSearch(searchString) {
  console.log(`\n\n=================== TESTING COOP SEARCH for "${searchString}" ===================`);
  
  let q = db.collection('cooperative_members');
  q = q.orderBy("createdAt", "desc");
  q = q.limit(5000);

  console.log("Firestore Query object (cooperative_members): built. Fetching...");
  const snapshot = await q.get();
  console.log(`Fetched docs count from Firestore: ${snapshot.docs.length}`);

  const applications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
  const userMap = new Map();
  const userPromises = [];
  for (let i = 0; i < userIds.length; i += 30) {
    const chunk = userIds.slice(i, i + 30);
    if (chunk.length > 0) {
      userPromises.push(db.collection('users').where(admin.firestore.FieldPath.documentId(), "in", chunk).get());
    }
  }
  const userSnapsArray = await Promise.all(userPromises);
  userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, d.data())));

  let standardForms = applications.map((app) => {
    const uData = userMap.get(app.userId) || {};
    const localName = app.firstName ? `${app.firstName} ${app.lastName || ''}`.trim() : (app.fullName || null);
    const userName = uData.firstName
        ? `${uData.firstName} ${uData.lastName || ''}`.trim()
        : (uData.fullName || uData.name || uData.displayName || localName || "");

    const mergedData = {
        ...app,
        phone:               app.phone               || uData.phone              || uData.phoneNumber || null,
        firstName:           app.firstName           || uData.firstName          || null,
        lastName:            app.lastName            || uData.lastName           || null,
        email:               app.email               || uData.email              || uData.userEmail  || null,
    };

    return {
        id: app.id,
        user: {
            id: app.userId,
            name: userName,
            email: mergedData.email || "",
            phone: mergedData.phone || "",
        },
        data: mergedData
    };
  });

  const s = searchString.toLowerCase().trim();
  const filtered = standardForms.filter((f) => {
      const searchString = [
          f.user?.name,
          f.user?.email,
          f.user?.phone,
          f.data?.firstName,
          f.data?.lastName,
          f.data?.phone
      ].filter(Boolean).map(String).join(" ").toLowerCase();
      return searchString.includes(s);
  });

  console.log(`Filtered Coop Members after search match: ${filtered.length}`);
  if (filtered.length > 0) {
    console.log("Found matches in Coop Members:");
    filtered.forEach(f => console.log(` - ID: ${f.id}, Name: ${f.user.name}, Email: ${f.user.email}`));
  }
}

async function run() {
  await testUsersSearch("onomos");
  await testUsersSearch("omorigheg@gmail.com");
  await testCoopSearch("onomos");
}

run().catch(console.error).then(() => process.exit(0));
