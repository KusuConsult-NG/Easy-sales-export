# WAVE Female-Only Requirement: Implementation Guide

## The Challenge

**Requirement**: WAVE program is only for female users  
**New Flow**: Global registration doesn't collect gender  
**Solution**: Gender validation happens in `/wave/application`, not during registration

---

## How It Works

### Step 1: Global Registration (Gender-Neutral)
```
User visits /wave/landing → Clicks "Apply"
       ↓
Redirected to /auth/register?callbackUrl=/wave/application
       ↓
Fills form: Name, Email, Password (NO gender field)
       ↓
Account created with role: ["general_user"]
```

**Key**: Registration is module-agnostic, no WAVE-specific fields

---

### Step 2: WAVE Application Form (Gender Required)

File: `/src/app/wave/application/page.tsx`

```typescript
export default async function WaveApplicationPage() {
    const session = await auth();
    if (!session?.user) {
        redirect("/auth/login?callbackUrl=/wave/application");
    }
    
    // Check if already applied
    const existingApp = await getUserWaveApplication(session.user.id);
    
    if (existingApp?.status === "pending") {
        return <PendingReview />;
    }
    
    if (existingApp?.status === "approved") {
        redirect("/wave/dashboard");
    }
    
    if (existingApp?.status === "rejected") {
        return <RejectedScreen reason={existingApp.rejectionReason} />;
    }
    
    // Show application form
    return <WaveApplicationForm />;
}
```

**Application form collects**:
- ✅ Gender (required, radio: Female/Male)
- ✅ Business proposal
- ✅ Funding amount
- ✅ Education & experience
- ✅ Documents

**Client-side validation**:
```typescript
function WaveApplicationForm() {
    const [gender, setGender] = useState<"female" | "male" | null>(null);
    
    const handleSubmit = async () => {
        if (gender !== "female") {
            showToast("WAVE program is exclusively for female entrepreneurs", "error");
            return;
        }
        
        // Submit application
        await submitWaveApplication({ gender, ...otherData });
    };
}
```

---

### Step 3: Admin Approval

Admin sees full application including gender:

```typescript
// Admin WAVE applications page
{applications.map(app => (
    <ApplicationCard>
        <Badge>{app.gender === "female" ? "✓ Eligible" : "⚠️ Ineligible"}</Badge>
        <p>Gender: {app.gender}</p>
        {app.gender !== "female" && (
            <Alert>This applicant does not meet WAVE eligibility criteria</Alert>
        )}
    </ApplicationCard>
))}
```

**Admin actions**:
- If female → Can approve
- If male → Auto-reject or show warning

---

### Step 4: Role Assignment (After Approval)

```typescript
async function approveWaveApplication(userId: string) {
    // Update serviceRegistrations
    await db.collection("users").doc(userId).update({
        "serviceRegistrations.wave": {
            status: "approved",
            approvedAt: FieldValue.serverTimestamp(),
        },
        roles: FieldValue.arrayUnion("wave_participant"),
    });
    
    // Invalidate cache
    await invalidateUserCache(userId);
}
```

---

## Alternative: Server-Side Auto-Reject

If you want to reject male applicants automatically:

```typescript
// In server action: submitWaveApplication
export async function submitWaveApplication(formData: FormData) {
    const gender = formData.get("gender") as "male" | "female";
    
    if (gender !== "female") {
        // Auto-reject or don't create application
        return {
            error: "WAVE program is exclusively for female entrepreneurs. Please explore our other programs.",
            redirectTo: "/dashboard",
        };
    }
    
    // Create application
    await createWaveApplication({ gender, ...data });
}
```

---

## Data Flow Diagram

```
Registration (no gender)
    ↓
general_user role assigned
    ↓
Redirect to /wave/application
    ↓
Application form (requires gender)
    ↓
Gender validation (must be female)
    ↓
Submit application → status: "pending"
    ↓
Admin reviews (sees gender)
    ↓
Approval → role updated to wave_participant
    ↓
Access granted to /wave/dashboard
```

---

## Benefits of This Approach

1. ✅ **Unified auth**: No module-specific registration
2. ✅ **WAVE requirements preserved**: Gender checked at application stage
3. ✅ **Flexible**: Users can explore other modules if ineligible for WAVE
4. ✅ **Clear messaging**: Rejection happens with context (at application, not registration)
5. ✅ **Admin workflow**: Admins see full context when reviewing

---

## Implementation Checklist

- [x] Create global RegisterForm (no gender field)
- [ ] Update /wave/application form to include gender
- [ ] Add client-side validation (female-only)
- [ ] Update server action to validate gender
- [ ] Admin UI shows gender in applications
- [ ] Rejection flow for male applicants

---

## User Experience

**Female user**:
1. Register → Apply to WAVE → Select "Female" → Submit → Approved → Dashboard ✅

**Male user**:
1. Register → Apply to WAVE → Select "Male" → Error message shown ❌
2. Redirected to explore other programs (Export, Marketplace, etc.) ✅

**Better UX**: Show WAVE eligibility on landing page to prevent wasted effort
