/**
 * CRITICAL FIX: Bulk-set profileComplete=true via Supabase Management API
 * 
 * This uses the /rest/v1/rpc approach with a PostgreSQL function, or
 * falls back to the Supabase Management API to run raw SQL directly.
 * 
 * A single server-side UPDATE handles all 33k users atomically.
 */

const https = require('https');
const { URL } = require('url');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Extract project ref from URL (https://xyzxyz.supabase.co -> xyzxyz)
const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];

console.log('=== profileComplete Bulk Fix via Supabase REST ===');
console.log('Project ref:', projectRef);

// The SQL we want to run
const FIX_SQL = `
UPDATE public.users
SET 
  raw_data = raw_data || '{"profileComplete": true}'::jsonb,
  updated_at = NOW()
WHERE 
  (raw_data->>'profileComplete') IS DISTINCT FROM 'true'
  AND (raw_data->>'fullName') IS NOT NULL
  AND trim(raw_data->>'fullName') != ''
`;

const COUNT_SQL = `
SELECT
  COUNT(*) FILTER (WHERE (raw_data->>'profileComplete') = 'true') as complete_true,
  COUNT(*) FILTER (WHERE (raw_data->>'profileComplete') IS NULL) as complete_null,
  COUNT(*) FILTER (WHERE (raw_data->>'profileComplete') = 'false') as complete_false,
  COUNT(*) as total
FROM public.users
`;

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const postData = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'return=minimal',
      }
    };

    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runViaRPC(sql) {
  // Try calling a stored procedure - Supabase allows executing SQL via pg_jsonb_path_ops
  // Actually use the /rest/v1/rpc/query endpoint if it exists
  const result = await makeRequest('POST', '/rest/v1/rpc/exec_sql', { sql });
  console.log('RPC exec_sql result:', result.status, JSON.stringify(result.body));
  return result.status < 300;
}

async function runViaSQLAPI(sql) {
  // Use Supabase's undocumented but functional SQL endpoint via the management API
  // This requires a special endpoint. Let's try the /rest/v1/ with a raw SQL approach
  // 
  // Actually the safest approach with only the REST API is to use the Supabase
  // management API if we have it, or the pg_jsonb approach.
  //
  // Since we only have the anon/service key (not the management token), let's
  // use a smarter batching approach: use the JSONB concatenation operator
  // via a single PostgREST PATCH with a filter.

  // PostgREST supports bulk updates via PATCH with a WHERE filter:
  // PATCH /rest/v1/users?raw_data->>profileComplete=neq.true
  // Body: { "raw_data": ... } — but PostgREST can't merge JSONB, it replaces the whole column

  // Best approach: Create a Supabase SQL Migration file and instruct user to run it
  return false;
}

async function main() {
  // Step 1: Run COUNT query to get current state
  // We can use PostgREST's built-in aggregation
  console.log('\n--- Current state ---');
  
  const totalRes = await makeRequest('GET', '/rest/v1/users?select=id&limit=1', null);
  // Use head request with count
  const countRes = await makeRequest('HEAD', '/rest/v1/users', null);
  
  console.log('Status check:', countRes.status);

  // Step 2: Try RPC
  const rpcWorked = await runViaRPC(FIX_SQL);

  if (!rpcWorked) {
    console.log('\n⚠️  Direct SQL execution not available via REST API.');
    console.log('\nThe safest approach requires running SQL directly in Supabase SQL Editor.');
    console.log('\n=== COPY THIS SQL AND RUN IN SUPABASE SQL EDITOR ===\n');
    console.log('-- Step 1: Preview (run this first to see what will be updated)');
    console.log(`SELECT COUNT(*) as will_fix
FROM public.users
WHERE (raw_data->>'profileComplete') IS DISTINCT FROM 'true'
  AND (raw_data->>'fullName') IS NOT NULL
  AND trim(raw_data->>'fullName') != '';`);
    console.log('\n-- Step 2: Apply the fix');
    console.log(FIX_SQL);
    console.log('\n-- Step 3: Verify');
    console.log(`SELECT
  COUNT(*) FILTER (WHERE (raw_data->>'profileComplete') = 'true') as complete_true,
  COUNT(*) FILTER (WHERE (raw_data->>'profileComplete') IS NULL) as complete_null,
  COUNT(*) FILTER (WHERE (raw_data->>'profileComplete') = 'false') as complete_false,
  COUNT(*) as total
FROM public.users;`);
    return;
  }

  console.log('\n✅ Fix applied successfully!');
}

main().catch(console.error);
