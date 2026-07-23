/**
 * FAST BULK APPLY: Apply recovered email matches from scratch/firebase-email-matches.json
 * to Supabase using concurrent batches (50 requests at a time).
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: require('ws') } }
);

async function applyFast() {
  const matchesPath = 'scratch/firebase-email-matches.json';
  if (!fs.existsSync(matchesPath)) {
    console.error('Matches file not found!');
    return;
  }

  const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
  console.log(`Loaded ${matches.length} recovered email records to apply to Supabase.`);

  let updated = 0;
  let failed = 0;
  const CONCURRENCY = 50;

  for (let i = 0; i < matches.length; i += CONCURRENCY) {
    const chunk = matches.slice(i, i + CONCURRENCY);

    const promises = chunk.map(async (match) => {
      const updatedRaw = {
        ...(match.existingRawData || {}),
        email: match.email,
        fullName: match.displayName || match.existingRawData?.fullName || '',
        profileComplete: true
      };

      const { error } = await supabase
        .from('users')
        .update({
          email: match.email,
          raw_data: updatedRaw,
          updated_at: new Date().toISOString()
        })
        .eq('id', match.id);

      if (error) {
        console.error(`Failed ${match.id}:`, error.message);
        return false;
      }
      return true;
    });

    const results = await Promise.all(promises);
    const chunkSuccess = results.filter(Boolean).length;
    updated += chunkSuccess;
    failed += (results.length - chunkSuccess);

    process.stdout.write(`  Applied: ${updated}/${matches.length} (Failed: ${failed})...\r`);
  }

  console.log(`\n\n🎉 BULK UPDATE COMPLETE!`);
  console.log(`✅ Successfully updated ${updated} user accounts with authentic emails!`);
  console.log(`❌ Failed: ${failed}`);

  // Verification
  const { count: nullRemaining } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .or('email.is.null,email.eq.')
    .not('raw_data->>_system_skeleton_backfill', 'eq', 'true');

  console.log(`\nRemaining non-skeleton NULL emails in Supabase: ${nullRemaining}`);
}

applyFast().catch(console.error);
