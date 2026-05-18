/**
 * audit-processed-payments.ts
 */
import { db } from "../src/lib/firebase-admin";

async function run() {
    // Count processedPayments docs
    const snap = await db.collection('processedPayments').limit(5000).get();
    console.log('processedPayments total docs:', snap.docs.length);
    
    // Group by type and status
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const doc of snap.docs) {
        const d: any = doc.data();
        const t = d.type || '(no type)';
        const s = d.status || '(no status)';
        byType[t] = (byType[t]||0)+1;
        byStatus[s] = (byStatus[s]||0)+1;
    }
    console.log('By status:', byStatus);
    console.log('By type (top):');
    Object.entries(byType)
        .sort((a: any, b: any) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([t,c]) => console.log(' ',t,':',c));
    
    // Cooperative-specific
    const coopCompleted = snap.docs.filter((d: any) => {
        const data = d.data();
        return data.status === 'completed' && (
            (data.type||'').toLowerCase().includes('cooperative') ||
            (data.type||'').toLowerCase().includes('membership')
        );
    });
    const uniqueCoopPaid = new Set(coopCompleted.map((d: any) => d.data().userId).filter(Boolean));
    console.log('\nCooperative completed payments:', coopCompleted.length);
    console.log('Unique userIds paid (coop):', uniqueCoopPaid.size);
    
    // All completed, any type - cross ref cooperative_members
    const allCompleted = snap.docs.filter((d: any) => d.data().status === 'completed');
    const allPaidUids = new Set(allCompleted.map((d: any) => d.data().userId).filter(Boolean));
    const membersSnap = await db.collection('cooperative_members').limit(5000).get();
    const memberUids = new Set(membersSnap.docs.map((d: any) => d.data().userId || d.id).filter(Boolean));
    const paidMembers = [...allPaidUids].filter(uid => memberUids.has(uid));
    
    console.log('\nAll completed payments (unique users):', allPaidUids.size);
    console.log('Of those — are cooperative members:', paidMembers.length);
}

run().catch(console.error).finally(()=>process.exit(0));
