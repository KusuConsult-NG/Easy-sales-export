/**
 * create-missing-indexes.ts
 * 
 * Creates the 5 missing composite Firestore indexes for Farm Nation
 * using gcloud user credentials (owner-level access).
 * 
 * Run: npx tsx scripts/create-missing-indexes.ts
 */

import * as https from "https";
import { execSync } from "child_process";

const PROJECT_ID = "easy-sales-hub";

// ── Indexes to create ─────────────────────────────────────────────────────────
const INDEXES_TO_CREATE = [
  {
    collection: "farm_nation_applications",
    fields: [
      { fieldPath: "status",      order: "ASCENDING"  },
      { fieldPath: "submittedAt", order: "DESCENDING" },
    ],
  },
  {
    collection: "farm_nation_applications",
    fields: [
      { fieldPath: "userId",      order: "ASCENDING"  },
      { fieldPath: "submittedAt", order: "DESCENDING" },
    ],
  },
  {
    collection: "farmNationProperties",
    fields: [
      { fieldPath: "verified",  order: "ASCENDING"  },
      { fieldPath: "createdAt", order: "DESCENDING" },
    ],
  },
  {
    collection: "farmNationProperties",
    fields: [
      { fieldPath: "ownerId",   order: "ASCENDING"  },
      { fieldPath: "verified",  order: "ASCENDING"  },
      { fieldPath: "createdAt", order: "DESCENDING" },
    ],
  },
  {
    collection: "farm_nation_inquiries",
    fields: [
      { fieldPath: "status",    order: "ASCENDING"  },
      { fieldPath: "createdAt", order: "DESCENDING" },
    ],
  },
  // cooperative_members: paymentStatus filter + orderBy createdAt
  {
    collection: "cooperative_members",
    fields: [
      { fieldPath: "paymentStatus", order: "ASCENDING"  },
      { fieldPath: "createdAt",     order: "DESCENDING" },
    ],
  },
  // cooperative_members: membershipStatus + paymentStatus + createdAt (combined filter)
  {
    collection: "cooperative_members",
    fields: [
      { fieldPath: "membershipStatus", order: "ASCENDING"  },
      { fieldPath: "paymentStatus",    order: "ASCENDING"  },
      { fieldPath: "createdAt",        order: "DESCENDING" },
    ],
  },
  // wave_applications: status + createdAt (needed when orderBy comes after where)
  {
    collection: "wave_applications",
    fields: [
      { fieldPath: "status",    order: "ASCENDING"  },
      { fieldPath: "createdAt", order: "DESCENDING" },
    ],
  },
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpsRequest(
  method: string,
  url: string,
  body: string | null,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts: https.RequestOptions = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: body
        ? { ...headers, "Content-Length": Buffer.byteLength(body) }
        : headers,
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function get(url: string, token: string) {
  return httpsRequest("GET", url, null, { Authorization: `Bearer ${token}` });
}

function post(url: string, payload: object, token: string) {
  return httpsRequest("POST", url, JSON.stringify(payload), {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Get token from gcloud (already logged in as easysalesexporthq@gmail.com)
  console.log("🔐 Getting access token from gcloud...");
  const token = execSync(
    "gcloud auth print-access-token --account=easysalesexporthq@gmail.com 2>/dev/null"
  )
    .toString()
    .trim();

  if (!token) throw new Error("Could not get access token from gcloud");
  console.log("✅ Token obtained\n");

  const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;

  // ── Collect existing indexes per collection ─────────────────────────────────
  console.log("📋 Fetching existing indexes per collection...");
  const existingKeys = new Set<string>();
  const uniqueCollections = [...new Set(INDEXES_TO_CREATE.map((i) => i.collection))];

  for (const col of uniqueCollections) {
    const url = `${baseUrl}/collectionGroups/${col}/indexes`;
    const res = await get(url, token);
    if (res.status === 200) {
      const parsed = JSON.parse(res.body);
      const indexes: any[] = parsed.indexes || [];
      // Filter to only COLLECTION scope composite indexes
      const composite = indexes.filter(
        (idx) =>
          idx.queryScope === "COLLECTION" &&
          idx.fields &&
          !idx.fields.some((f: any) => f.fieldPath === "__name__")
      );
      for (const idx of composite) {
        const key = idx.fields
          .map((f: any) => `${f.fieldPath}:${f.order || f.arrayConfig || ""}`)
          .join("|");
        existingKeys.add(`${col}::${key}`);
      }
      console.log(`   ${col}: ${composite.length} composite index(es) found`);
    } else {
      console.log(`   ${col}: HTTP ${res.status}`);
    }
  }
  console.log();

  // ── Create each missing index ───────────────────────────────────────────────
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const def of INDEXES_TO_CREATE) {
    const key = `${def.collection}::${def.fields
      .map((f) => `${f.fieldPath}:${f.order}`)
      .join("|")}`;
    const label = def.fields.map((f) => `${f.fieldPath} ${f.order.toLowerCase()}`).join(" + ");

    if (existingKeys.has(key)) {
      console.log(`⏭️  EXISTS  [${def.collection}]  ${label}`);
      skipped++;
      continue;
    }

    const createUrl = `${baseUrl}/collectionGroups/${def.collection}/indexes`;
    const payload = {
      queryScope: "COLLECTION",
      fields: def.fields,
    };

    const res = await post(createUrl, payload, token);

    if (res.status === 200 || res.status === 409) {
      const op = JSON.parse(res.body);
      console.log(`✅ CREATED [${def.collection}]  ${label}`);
      const opId = op.name?.split("/").pop() ?? "?";
      console.log(`   ↳ Operation: ${opId} (status: CREATING)`);
      created++;
    } else {
      let errMsg = res.body.slice(0, 300);
      try {
        errMsg = JSON.parse(res.body)?.error?.message ?? errMsg;
      } catch (_) {}
      console.error(`❌ FAILED  [${def.collection}]  ${label}`);
      console.error(`   HTTP ${res.status}: ${errMsg}`);
      failed++;
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Summary
   ✅ Created  : ${created}
   ⏭️  Skipped  : ${skipped}
   ❌ Failed   : ${failed}

${created > 0 ? `⏳ New indexes take 2–10 min to build. Check progress:
   https://console.firebase.google.com/project/${PROJECT_ID}/firestore/indexes` : ""}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
