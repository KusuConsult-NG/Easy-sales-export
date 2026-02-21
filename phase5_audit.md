# Phase 5: Firestore Schema Consistency Audit

## File: `src/app/actions/academy-admin.ts`

### Match at line 47:
```typescript
        await appRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 54:
```typescript
        await db.collection("users").doc(userId).set({
            isVerified: true,
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("academy_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
```

### Match at line 62:
```typescript
        await db.collection("users").doc(userId).update({
            "serviceRegistrations.academy.status": "approved",
            "serviceRegistrations.academy.applicationId": applicationId,
            "serviceRegistrations.academy.approvedAt": FieldValue.serverTimestamp(),
        });
```

### Match at line 164:
```typescript
        await appRef.update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 174:
```typescript
            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                "serviceRegistrations.academy.status": "rejected",
                "serviceRegistrations.academy.rejectedAt": FieldValue.serverTimestamp(),
            });
```

## File: `src/app/actions/academy-payment.ts`

### Match at line 71:
```typescript
        await db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId).set({
            userId: session.user.id,
            courseId,
            fullName,
            email: session.user.email,
            phone,
            amount,
            paymentReference: reference,
            status: "pending_payment", // pending_payment | active | completed | dropped
            progress: 0,
            enrollmentDate: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/academy.ts`

### Match at line 766:
```typescript
        await db.collection("users").doc(session.user.id).update({
            "serviceRegistrations.academy.paymentStatus": "completed",
            "serviceRegistrations.academy.paymentReference": reference,
            "serviceRegistrations.academy.paymentAmount": verify.data.amount / 100,
            "serviceRegistrations.academy.plan": metadata.plan || "foundation",
            "serviceRegistrations.academy.paidAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        });
```

### Match at line 837:
```typescript
        await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).set({
            ...applicationData,
            userId: session.user.id,
            applicationId,
            status: "pending",
            submittedAt: FieldValue.serverTimestamp(),
            reviewedAt: null,
            reviewedBy: null,
            notes: "",
        });
```

### Match at line 850:
```typescript
        await db.collection("users").doc(session.user.id).update({
            "serviceRegistrations.academy.status": "pending",
            "serviceRegistrations.academy.applicationId": applicationId,
            "serviceRegistrations.academy.submittedAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        });
```

### Match at line 897:
```typescript
        const docRef = await db.collection("academy_courses").add({
            ...validatedData,
            instructorId: session.user.id, // Ensure instructor is linked
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            modules: [],
            status: "draft",
        });
```

### Match at line 927:
```typescript
        await db.collection("academy_courses").doc(courseId).update({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 954:
```typescript
        await db.collection("academy_courses").doc(courseId).update({
            modules,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/admin-communications.ts`

### Match at line 118:
```typescript
        await db.collection('email_history').add({
            recipients: recipients,
            subject,
            body,
            recipientCount: emails.length,
            sentBy: session.user.id,
            sentAt: FieldValue.serverTimestamp(),
            status: 'sent'
        });
```

### Match at line 161:
```typescript
        const announcementRef = await db.collection('announcements').add({
            title,
            message,
            priority,
            active: true,
            createdBy: session.user.id,
            createdAt: FieldValue.serverTimestamp()
        });
```

## File: `src/app/actions/admin-content.ts`

### Match at line 144:
```typescript
                await db.collection("marketplace_products").doc(id).update({
                    status: "approved",
                    approvedAt: timestamp,
                    approvedBy: adminId,
                });
```

### Match at line 151:
```typescript
                await db.collection("land_listings").doc(id).update({
                    verificationStatus: "verified",
                    verifiedAt: timestamp,
                    verifiedBy: adminId,
                });
```

### Match at line 158:
```typescript
                await db.collection("loans").doc(id).update({
                    status: "approved", // or 'processing' depending on flow, but 'approved' for now
                    approvedAt: timestamp,
                    approvedBy: adminId,
                });
```

### Match at line 165:
```typescript
                await db.collection("wave_applications").doc(id).update({
                    status: "approved",
                    approvedAt: timestamp,
                    approvedBy: adminId,
                });
```

### Match at line 207:
```typescript
                await db.collection("marketplace_products").doc(id).update({
                    status: "rejected",
                    rejectionReason: reason,
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
```

### Match at line 215:
```typescript
                await db.collection("land_listings").doc(id).update({
                    verificationStatus: "rejected",
                    verificationNotes: reason, // land uses 'verificationNotes' usually
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
```

### Match at line 223:
```typescript
                await db.collection("loans").doc(id).update({
                    status: "rejected",
                    rejectionReason: reason,
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
```

### Match at line 231:
```typescript
                await db.collection("wave_applications").doc(id).update({
                    status: "rejected",
                    rejectionReason: reason,
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
```

## File: `src/app/actions/admin.ts`

### Match at line 68:
```typescript
        await appRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 77:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            isVerified: true,
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("wave_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 86:
```typescript
        await db.collection("wave_members").doc(userId).set({
            active: true,
            enrolledAt: FieldValue.serverTimestamp(),
            applicationId: applicationId,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
```

### Match at line 176:
```typescript
        await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 192:
```typescript
            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                "serviceRegistrations.wave.status": "rejected",
                "serviceRegistrations.wave.rejectedAt": FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
```

### Match at line 291:
```typescript
        await withdrawalRef.update({
            status: action === "approve" ? "completed" : "rejected",
            processedBy: session.user.id,
            processedAt: FieldValue.serverTimestamp(),
            adminNotes: reasoning || "",
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 359:
```typescript
        await userRef.update({
            isVerified: newVerificationStatus,
            verifiedBy: session.user.id,
            verifiedAt: newVerificationStatus ? FieldValue.serverTimestamp() : null,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 560:
```typescript
        await listingRef.update({
            verificationStatus: decision,
            verified: decision === "approved",
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            rejectionReason: decision === "rejected" ? reason : null,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 790:
```typescript
                await loanRef.update({
                    approvalChain: {
                        firstApprover: session.user.id,
                        firstApprovalAt: FieldValue.serverTimestamp(),
                        firstApproverName: session.user.name || session.user.email
                    },
                    status: "partially_approved", // Intermediate status
                    updatedAt: FieldValue.serverTimestamp(),
                });
```

### Match at line 822:
```typescript
                await loanRef.update({
                    "approvalChain.secondApprover": session.user.id,
                    "approvalChain.secondApprovalAt": FieldValue.serverTimestamp(),
                    "approvalChain.secondApproverName": session.user.name || session.user.email,
                });
```

### Match at line 833:
```typescript
        await loanRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 945:
```typescript
        await loanRef.update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 1219:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            roles: roles,
            updatedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp()
        });
```

### Match at line 1268:
```typescript
        await verificationRef.update({
            status: "approved",
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 1276:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            isVerified: true,
            sellerVerificationStatus: "approved",
            sellerVerificationId: verificationId,
            verifiedBy: session.user.id, // Track who verified the user
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("seller"),
            // SYNC CONTACT INFO: Update phone with verified number to prevent data drift
            phone: verificationData.phoneNumber,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 1392:
```typescript
        await appDoc.ref.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 1400:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            isVerified: true,
            "services.export.status": "active",
            "services.export.approvedAt": FieldValue.serverTimestamp(),
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("export_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 1504:
```typescript
        await appDoc.ref.update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 1513:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.export.status": "rejected",
            "serviceRegistrations.export.rejectedAt": FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 1653:
```typescript
        await appRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 1661:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).set({
            serviceRegistrations: {
                academy: {
                    status: "approved",
                    approvedAt: FieldValue.serverTimestamp(),
                }
            },
            roles: FieldValue.arrayUnion("academy_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
```

### Match at line 1709:
```typescript
        await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 1721:
```typescript
                await db.collection(COLLECTIONS.USERS).doc(userId).set({
                    serviceRegistrations: {
                        academy: {
                            status: "rejected",
                        }
                    },
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
```

## File: `src/app/actions/admin_extensions.ts`

### Match at line 51:
```typescript
        await userRef.update({
            deleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            deletedBy: session.user.id,

            // PII Removal
            email: scrubbedEmail,
            originalEmail: userData.email, // Optional: Keep for audit, or remove if strict GDPR
            phone: scrubbedPhone,
            fullName: scrubbedName,
            displayName: scrubbedName,

            // Deactivate Roles
            roles: ["deleted"],
            isActive: false,

            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/ai-actions.ts`

### Match at line 85:
```typescript
        const chatRef = await db.collection('ai_chat_history').add({
            userId: session.user.id,
            message: validated.message,
            response: aiResponse,
            context: validated.context || {},
            createdAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/audit.ts`

### Match at line 86:
```typescript
        await db.collection(COLLECTIONS.AUDIT_LOGS).add({
            action,
            adminId: session.user.id,
            adminEmail: session.user.email || "",
            targetId,
            targetType,
            details,
            timestamp: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/auth.ts`

### Match at line 207:
```typescript
            await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).set({
                ...userProfile,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
```

## File: `src/app/actions/briefing.ts`

### Match at line 71:
```typescript
            const docRef = await db.collection("wave_briefing_registrations").add({
                fullName: validData.fullName,
                phoneNumber: phoneToStore,
                email: emailToStore,
                state: validData.state,
                role: validData.role,
                createdAt: FieldValue.serverTimestamp(), // Standardized from registeredAt
                updatedAt: FieldValue.serverTimestamp(), // Standardized
                status: status,
                confirmationSent: false,
                attended: false, // Explicit field for attendance tracking
            });
```

### Match at line 94:
```typescript
                    await docRef.update({ confirmationSent: true });
```

## File: `src/app/actions/bulk-user-operations.ts`

### Match at line 435:
```typescript
                await userRef.update({
                    deleted: true,
                    deletedAt: FieldValue.serverTimestamp(),
                    deletedBy: session.user.id,
                    deletionReason: reason,
                    suspended: true,
                });
```

### Match at line 541:
```typescript
        const impersonationRef = await db.collection(COLLECTIONS.IMPERSONATION_TOKENS).add({
            adminId: session.user.id,
            targetUserId,
            reason,
            createdAt: FieldValue.serverTimestamp(),
            expiresAt,
            active: true,
            usedAt: null,
        });
```

## File: `src/app/actions/certificates.ts`

### Match at line 177:
```typescript
        await userRef.update({
            onboardingCompleted: true,
            onboardingCompletedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/cms.ts`

### Match at line 164:
```typescript
        await announcementRef.update({
            active: false,
        });
```

### Match at line 284:
```typescript
        await bannerRef.update({
            active: false,
        });
```

## File: `src/app/actions/cooperative-admin.ts`

### Match at line 248:
```typescript
        await db.collection("cooperative_members").doc(memberId).update({
            membershipStatus: status,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 256:
```typescript
            await db.collection("users").doc(memberId).set({
                isVerified: true,
                roles: FieldValue.arrayUnion("cooperative_member"),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
```

### Match at line 262:
```typescript
            await db.collection("users").doc(memberId).update({
                "serviceRegistrations.cooperatives.status": "active",
                "serviceRegistrations.cooperatives.activatedAt": FieldValue.serverTimestamp(),
            });
```

## File: `src/app/actions/cooperative.ts`

### Match at line 75:
```typescript
        await memberRef.set({
            userId,
            membershipTier: tier,
            registrationFee,
            membershipStatus: "pending",
            paymentStatus: "pending",
            updatedAt: FieldValue.serverTimestamp(),
            // Preserve creation date if exists
            createdAt: memberDoc.exists ? memberDoc.data()?.createdAt : FieldValue.serverTimestamp(),
        }, { merge: true });
```

### Match at line 121:
```typescript
        await memberRef.update({
            paymentReference: paystackData.data.reference,
        });
```

### Match at line 254:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.cooperatives.status": "pending",
            "serviceRegistrations.cooperatives.membershipTier": validatedData.membershipTier,
            "serviceRegistrations.cooperatives.onboardingCompletedAt": FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 311:
```typescript
        await membershipsRef.add({
            userId,
            cooperativeId,
            savingsBalance: initialContribution,
            loanBalance: 0,
            memberSince: FieldValue.serverTimestamp(),
            monthlyTarget: 50000,
            status: "active"
        });
```

### Match at line 324:
```typescript
            await transactionsRef.add({
                userId,
                cooperativeId,
                type: "contribution",
                amount: initialContribution,
                date: FieldValue.serverTimestamp(),
                status: "completed",
                description: "Initial contribution upon joining"
            });
```

### Match at line 335:
```typescript
            await cooperativeRef.update({
                totalSavings: FieldValue.increment(initialContribution),
                memberCount: FieldValue.increment(1)
            });
```

### Match at line 340:
```typescript
            await cooperativeRef.update({
                memberCount: FieldValue.increment(1)
            });
```

### Match at line 406:
```typescript
        await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).add({
            userId,
            cooperativeId,
            type,
            amount,
            date: FieldValue.serverTimestamp(),
            status: "completed",
            description: type === "savings" ? "Savings contribution" : "Loan repayment"
        });
```

### Match at line 418:
```typescript
            await membershipDoc.ref.update({
                savingsBalance: FieldValue.increment(amount)
            });
```

### Match at line 422:
```typescript
            await db.collection(COLLECTIONS.COOPERATIVES).doc(cooperativeId).update({
                totalSavings: FieldValue.increment(amount)
            });
```

### Match at line 426:
```typescript
            await membershipDoc.ref.update({
                loanBalance: FieldValue.increment(-amount)
            });
```

### Match at line 666:
```typescript
        await loansRef.add({
            memberId: userId,
            productId,
            amount,
            purpose,
            interestAmount,
            totalRepayment,
            monthlyPayment,
            durationMonths,
            status: "pending",
            appliedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/course-actions.ts`

### Match at line 34:
```typescript
        await lessonProgressRef.set({
            userId: session.user.id,
            courseId: validated.courseId,
            lessonId: validated.lessonId, // Now required
            progressPercent: validated.progressPercent,
            lastWatchedSecond: validated.lastWatchedSecond,
            completed: validated.progressPercent >= 95,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
```

### Match at line 92:
```typescript
        const enrollmentRef = await db.collection('course_enrollments').add({
            userId: session.user.id,
            courseId: validated.courseId,
            enrolledAt: FieldValue.serverTimestamp(),
            status: 'active',
        });
```

### Match at line 100:
```typescript
        await db.collection('course_progress').add({
            userId: session.user.id,
            courseId: validated.courseId,
            progressPercent: 0,
            lastWatchedSecond: 0,
            completed: false,
            completedAt: null,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 261:
```typescript
        await progressDoc.ref.update({
            completed: true,
            completedAt: FieldValue.serverTimestamp(),
            progressPercent: 100,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 326:
```typescript
        const certificateRef = await db.collection('course_certificates').add({
            userId: session.user.id,
            userName: session.user.name || "Unknown",
            userEmail: session.user.email,
            courseId,
            courseTitle,
            completedAt: progressData.completedAt || FieldValue.serverTimestamp(),
            issuedAt: FieldValue.serverTimestamp(),
            certificateNumber: `CERT-${Date.now()}-${session.user.id?.substring(0, 8)}`,
        });
```

## File: `src/app/actions/disputes.ts`

### Match at line 88:
```typescript
        await db.collection(COLLECTIONS.ORDERS).doc(orderId).update({
            status: "disputed",
            disputeId: disputeRef.id,
            updatedAt: new Date(),
        });
```

### Match at line 321:
```typescript
                await db.collection(COLLECTIONS.ORDERS).doc(dispute.orderId).update({
                    status: newOrderStatus,
                    updatedAt: new Date(),
                });
```

## File: `src/app/actions/escrow-actions.ts`

### Match at line 121:
```typescript
        await txRef.update({
            status,
            updatedAt: FieldValue.serverTimestamp(),
            [`${status}At`]: FieldValue.serverTimestamp(), // e.g., deliveredAt, completedAt
        });
```

### Match at line 211:
```typescript
        await txRef.update({
            status: "disputed",
            disputeId: disputeRef.id,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 293:
```typescript
        await txRef.update({
            status: "completed",
            releasedAt: FieldValue.serverTimestamp(),
            releasedBy: userId,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 385:
```typescript
        await txRef.update({
            status: "cancelled",
            refundedAt: FieldValue.serverTimestamp(),
            refundedBy: userId,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/escrow.ts`

### Match at line 118:
```typescript
        await escrowRef.update({
            status: "held",
            paymentReference,
            paidAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 166:
```typescript
        await escrowRef.update({
            releaseRequestedAt: FieldValue.serverTimestamp(),
            releaseRequestedBy: sellerId,
        });
```

### Match at line 200:
```typescript
        await escrowRef.update({
            status: "released",
            releasedAt: FieldValue.serverTimestamp(),
            releasedBy: adminId,
        });
```

### Match at line 256:
```typescript
        await db.collection("escrow_transactions").doc(data.escrowId).update({
            status: "disputed",
        });
```

### Match at line 302:
```typescript
        await disputeRef.update({
            status: "resolved",
            resolution,
            resolvedBy: adminId,
            resolvedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 311:
```typescript
        await escrowRef.update({
            status: outcome === "release_to_seller" ? "released" : "refunded",
            releasedBy: adminId,
            [outcome === "release_to_seller" ? "releasedAt" : "refundedAt"]: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/export-aggregation.ts`

### Match at line 160:
```typescript
        await windowRef.update({
            currentVolume: windowData.currentVolume + data.volume,
        });
```

## File: `src/app/actions/export-booking.ts`

### Match at line 52:
```typescript
        const bookingRef = await db.collection('export_bookings').add({
            userId: session.user.id,
            exportWindowId: data.exportWindowId,
            quantity: data.quantity,
            totalPrice: data.totalPrice,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 63:
```typescript
        await windowRef.update({
            currentVolume: FieldValue.increment(data.quantity),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/export-payment.ts`

### Match at line 96:
```typescript
        await db.collection("exportInvestments").doc(investmentId).set({
            investmentId,
            windowId,
            windowTitle,
            commodity,
            investorId: session.user.id,
            investorEmail: session.user.email,
            investorName: session.user.name || session.user.email,
            amount: investmentAmount,
            expectedROI,
            expectedReturn: investmentAmount * (1 + expectedROI / 100),
            paymentReference: reference,
            status: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/export-status.ts`

### Match at line 49:
```typescript
        await exportRef.update({
            status: newStatus,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/export.ts`

### Match at line 128:
```typescript
        await exportWindowRef.set({
            orderId,
            commodity: validatedData.commodity,
            quantity: validatedData.quantity,
            amount: validatedData.amount,
            destination: validatedData.destination || "other",
            status: "pending",
            userId: session.user.id,
            orderDate: FieldValue.serverTimestamp(),
            deliveryDate: validatedData.deliveryDate ? new Date(validatedData.deliveryDate) : null,
            escrowReleaseDate: escrowReleaseDate,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 191:
```typescript
        await exportRef.update({
            status: newStatus,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 234:
```typescript
        await exportRef.update({
            ...cleanData,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 514:
```typescript
        await userRef.update({
            "serviceRegistrations.export.status": "pending_approval",
            "serviceRegistrations.export.applicationId": applicationId,
            "serviceRegistrations.export.appliedAt": FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 923:
```typescript
        await exportRef.update({
            escrowReleaseDate: newReleaseDate,
            updatedAt: FieldValue.serverTimestamp(),
            // We might want to track extensions in a subcollection or array, but for now just audit log
        });
```

## File: `src/app/actions/farm-nation-payment.ts`

### Match at line 80:
```typescript
        await db.collection("propertyPurchases").doc(purchaseId).set({
            purchaseId,
            propertyId,
            propertyTitle,
            buyerId: session.user.id,
            buyerEmail: session.user.email,
            sellerId,
            amount,
            paymentReference: reference,
            status: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 170:
```typescript
        await propertyRef.update({
            ownerId: session.user.id,
            ownerEmail: session.user.email,
            previousOwnerId: propertyData.ownerId,
            status: "sold",
            soldAt: FieldValue.serverTimestamp(),
            salePrice: amountInNaira,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 188:
```typescript
            await db.collection("propertyPurchases").doc(purchaseDoc.id).update({
                status: "completed",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
```

## File: `src/app/actions/farm-nation.ts`

### Match at line 160:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.farmNation.status": "approved",
            "serviceRegistrations.farmNation.approvedAt": FieldValue.serverTimestamp(),
            "serviceRegistrations.farmNation.approvedBy": session.user.id,
            roles: FieldValue.arrayUnion("farm-nation-seller")
        });
```

### Match at line 189:
```typescript
        await propertyRef.update({
            viewCount: (data.viewCount || 0) + 1,
        });
```

### Match at line 398:
```typescript
        await propertyRef.update({
            status: "pending",
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 477:
```typescript
        await requestRef.update({
            status: "cancelled",
            escrowStatus: "refunded",
            cancelledAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 486:
```typescript
            await db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(requestData.propertyId).update({
                status: "available",
                updatedAt: FieldValue.serverTimestamp(),
            });
```

### Match at line 540:
```typescript
        await propertyRef.update({
            status: "deleted",
            deletedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 728:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.farmNation.status": "pending",
            "serviceRegistrations.farmNation.role": data.role,
            "serviceRegistrations.farmNation.completedAt": FieldValue.serverTimestamp(),
            "serviceRegistrations.farmNation.submittedAt": FieldValue.serverTimestamp(),
        });
```

### Match at line 808:
```typescript
        await propertyRef.update({
            documents: newDocs,
            updatedAt: FieldValue.serverTimestamp(),
            verificationStatus: "pending_review" // Reset verification status if new docs added
        });
```

### Match at line 851:
```typescript
        await propertyRef.update({
            verified: verified,
            verifiedAt: verified ? FieldValue.serverTimestamp() : null,
            verifiedBy: verified ? session.user.id : null,
            updatedAt: FieldValue.serverTimestamp(),
            // Ensure status reflects verification
            status: verified ? "available" : property.status // Keep existing if un-verifying, or reset? Let's leave status alone unless it was explicitly pending.
        });
```

## File: `src/app/actions/feature-toggles.ts`

### Match at line 55:
```typescript
            await toggleRef.update({
                enabled,
                updatedAt: FieldValue.serverTimestamp(),
            });
```

### Match at line 61:
```typescript
            await toggleRef.set({
                id: featureName,
                name: featureName,
                description: `Feature toggle for ${featureName}`,
                enabled,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                createdBy: session.user.id,
            });
```

## File: `src/app/actions/land-actions.ts`

### Match at line 36:
```typescript
        const listingRef = await db.collection('land_listings').add({
            ...validated,
            location: {
                ...validated.location,
                geopoint: geoPoint, // For geospatial queries
            },
            ownerId: session.user.id,
            status: 'pending_verification',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            verifiedAt: null,
            verifiedBy: null,
            rejectionReason: null,
        });
```

### Match at line 266:
```typescript
        await db.collection('land_listings').doc(listingId).update({
            ...updateData,
            updatedAt: FieldValue.serverTimestamp(),
            // Reset to pending if content changed
            status: 'pending_verification',
        });
```

### Match at line 375:
```typescript
        await db.collection('land_listings').doc(listingId).update({
            status: 'deleted',
            deletedAt: FieldValue.serverTimestamp(),
            deletedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/land-listings.ts`

### Match at line 108:
```typescript
        await listingRef.update({
            status: "pending_verification",
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 140:
```typescript
        await listingRef.update({
            status: "verified",
            verificationStatus: {
                verified: true,
                verifiedBy: adminId,
                verifiedAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 185:
```typescript
        await listingRef.update({
            status: "rejected",
            verificationStatus: {
                verified: false,
                verifiedBy: adminId,
                verifiedAt: FieldValue.serverTimestamp(),
                rejectionReason: reason,
            },
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 449:
```typescript
        const inquiryRef = await db.collection("land_inquiries").add({
            ...data,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            read: false
        });
```

## File: `src/app/actions/loan-actions.ts`

### Match at line 31:
```typescript
        const loanRef = await db.collection('loan_applications').add({
            ...validated,
            userId: session.user.id,
            status: LoanStatus.PENDING,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            approvedBy: null,
            approvedAt: null,
            rejectionReason: null,
        });
```

### Match at line 248:
```typescript
        await db.collection('loan_applications').doc(loanId).update({
            status: LoanStatus.DISBURSED,
            disbursedAt: FieldValue.serverTimestamp(),
            disbursedBy: session.user.id,
            disbursementNotes,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/loans.ts`

### Match at line 305:
```typescript
        await appRef.update({
            status: "rejected",
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedBy: effectiveAdminId,
            rejectionReason: reason,
        });
```

### Match at line 479:
```typescript
            const installmentRef = await db.collection("loan_repayments").add({
                loanId,
                userId: loanData.userId,
                installmentNumber: i + 1,
                dueDate: Timestamp.fromDate(dueDate),
                principalAmount: inst.principalAmount,
                interestAmount: inst.interestAmount,
                totalAmount: inst.totalAmount,
                paidAmount: 0,
                status: "pending",
            });
```

### Match at line 641:
```typescript
            await loanRef.update({
                status: "repaid",
            });
```

## File: `src/app/actions/marketplace-payment.ts`

### Match at line 136:
```typescript
        await db.collection("marketplaceOrders").doc(orderId).set({
            sellerIds,
            orderId,
            buyerId: session.user.id,
            buyerEmail,
            buyerPhone,
            items: validatedItems, // Use validated items
            productIds: validatedItems.map(i => i.productId), // For querying
            subtotal,
            deliveryFee: calculatedDeliveryFee, // Use server calculated fee
            totalAmount,
            paymentReference: reference,
            paymentStatus: "pending",
            orderStatus: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 429:
```typescript
        await db.collection("marketplaceOrders").doc(orderId).set({
            sellerIds,
            orderId,
            buyerId: session.user.id,
            buyerEmail,
            buyerPhone,
            items: validatedItems, // Use validated items
            productIds: validatedItems.map(i => i.productId), // For querying
            subtotal,
            deliveryFee: calculatedDeliveryFee, // Use server calculated fee
            totalAmount,
            paymentMethod: "bank_transfer",
            paymentReference: orderReference,
            paymentStatus: "pending_verification",
            orderStatus: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/marketplace.ts`

### Match at line 139:
```typescript
        await userRef.update({
            sellerVerificationStatus: "pending",
            sellerVerificationId: verificationId,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 313:
```typescript
        await userRef.update({
            phone: formData.get("phone") as string,
            location: `${location.address}, ${location.lga}, ${location.state}`, // Simplified location string
            isSeller: true, // Flag to indicate seller intent
            sellerVerificationStatus: "pending",
            sellerVerificationId: verificationId,
            // Use dot notation to preserve other service registrations (Academy, Cooperatives, etc.)
            "serviceRegistrations.marketplace": {
                status: "pending",
                verificationId,
                accountType: formData.get("accountType") as string,
                submittedAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 981:
```typescript
        await productRef.update({
            status: "deleted",
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/messages.ts`

### Match at line 127:
```typescript
        await conversationRef.update({
            lastMessage: {
                text: trimmedText,
                senderId: session.user.id,
                timestamp: FieldValue.serverTimestamp()
            },
            updatedAt: FieldValue.serverTimestamp()
        });
```

### Match at line 156:
```typescript
        await conversationRef.update({
            [`participantDetails.${session.user.id}.lastRead`]: FieldValue.serverTimestamp()
        });
```

## File: `src/app/actions/notifications.ts`

### Match at line 119:
```typescript
        await db.collection("notifications").doc(notificationId).update({
            read: true,
            readAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/order-management.ts`

### Match at line 211:
```typescript
        await orderRef.update({
            buyerConfirmed: true,
            buyerConfirmedAt: FieldValue.serverTimestamp(),
            status: "completed",
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/orders.ts`

### Match at line 209:
```typescript
        await db.collection(COLLECTIONS.ORDERS).doc(orderId).update({
            paymentStatus: paymentStatus === "success" ? "paid" : "failed",
            paymentReference,
            status: paymentStatus === "success" ? "confirmed" : "cancelled",
            updatedAt: new Date(),
        });
```

## File: `src/app/actions/password-reset.ts`

### Match at line 63:
```typescript
        await db.collection('password_resets').add({
            email,
            token,
            expiry,
            used: false,
            createdAt: FieldValue.serverTimestamp()
        });
```

### Match at line 161:
```typescript
        await db.collection('password_resets').doc(resetDoc.id).update({
            used: true,
            usedAt: FieldValue.serverTimestamp()
        });
```

## File: `src/app/actions/payments.ts`

### Match at line 95:
```typescript
        await paymentRef.update({
            status: "success",
            completedAt: FieldValue.serverTimestamp(),
            paystackResponse,
        });
```

### Match at line 134:
```typescript
                    await escrowRef.update({
                        status: "held",
                        paymentReference: payment.paymentReference,
                        paidAt: FieldValue.serverTimestamp(),
                    });
```

### Match at line 146:
```typescript
                    await slotRef.update({
                        status: "paid",
                        paidAt: FieldValue.serverTimestamp(),
                    });
```

## File: `src/app/actions/platform.ts`

### Match at line 96:
```typescript
        await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).set({
            ...validatedData,
            userId: session.user.id,
            status: "pending", // pending | approved | rejected
            applicationDate: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 162:
```typescript
        await enrollmentRef.set({
            userId: session.user.id,
            courseId: validatedData.courseId,
            fullName: validatedData.fullName,
            email: validatedData.email,
            phone: validatedData.phone,
            enrollmentDate: FieldValue.serverTimestamp(),
            status: "active", // active | completed | dropped
            progress: 0,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 178:
```typescript
            await courseRef.update({
                students: FieldValue.increment(1),
            });
```

## File: `src/app/actions/profile.ts`

### Match at line 91:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            ...validated,
            updatedAt: new Date(),
        });
```

### Match at line 129:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            notifications: validated,
            updatedAt: new Date(),
        });
```

## File: `src/app/actions/resource-actions.ts`

### Match at line 187:
```typescript
        await resourceRef.update({
            downloads: FieldValue.increment(1),
        });
```

### Match at line 231:
```typescript
        await resourceRef.update({
            isActive: false,
        });
```

### Match at line 279:
```typescript
        await resourceRef.update({
            title,
            description,
            tags: tags ? tags.split(",").map(t => t.trim()) : [],
        });
```

## File: `src/app/actions/review-moderation.ts`

### Match at line 121:
```typescript
        await reviewRef.update({
            moderationStatus: "approved",
            moderatedBy: session.user.id,
            moderatedAt: FieldValue.serverTimestamp(),
            flagCount: 0,
            flaggedBy: [],
            flagReasons: [],
        });
```

### Match at line 174:
```typescript
        await reviewRef.update({
            deleted: true,
            deletedBy: session.user.id,
            deletedAt: FieldValue.serverTimestamp(),
            deletionReason: reason,
            moderationStatus: "rejected",
        });
```

### Match at line 200:
```typescript
                await productRef.update({
                    rating: newAverage,
                    reviewCount: newCount,
                });
```

### Match at line 258:
```typescript
        await userRef.update({
            reviewSuspended: true,
            reviewSuspendedUntil: suspendedUntil,
            reviewSuspensionReason: reason,
            suspendedBy: session.user.id,
            suspendedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/reviews.ts`

### Match at line 235:
```typescript
        await reviewRef.update({
            rating,
            comment: comment.trim(),
            status: "pending", // Re-trigger moderation
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/setup.ts`

### Match at line 28:
```typescript
            await cooperativeRef.set({
                id: cooperativeId,
                name: "Ezichi Farmers Cooperative",
                description: "A cooperative society for farmers in the Easy Sales Export community",
                memberCount: 0,
                totalSavings: 0,
                totalLoans: 0,
                monthlyTarget: 50000,
                interestRate: 5,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                status: "active",
            });
```

### Match at line 53:
```typescript
        await memberRef.set({
            userId,
            cooperativeId,
            savingsBalance: initialSavings,
            loanBalance: 0,
            memberSince: FieldValue.serverTimestamp(),
            monthlyTarget: 50000,
            status: "active",
        });
```

### Match at line 64:
```typescript
        await cooperativeRef.update({
            memberCount: FieldValue.increment(1),
            totalSavings: FieldValue.increment(initialSavings),
        });
```

### Match at line 74:
```typescript
            await userRef.update({
                cooperativeId,
                updatedAt: FieldValue.serverTimestamp(),
            });
```

## File: `src/app/actions/user.ts`

### Match at line 33:
```typescript
            await userRef.update({
                fullName: "Redacted User",
                email: "deleted_" + userId + "@redacted.local",
                phone: FieldValue.delete(),
                gender: FieldValue.delete(),
                address: FieldValue.delete(),
                bankDetails: FieldValue.delete(),
                mfaEnabled: false,
                totpSecret: FieldValue.delete(),
                mfaRecoveryCodes: FieldValue.delete(),

                // Track deletion status and timestamp
                deleted: true,
                deletedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
```

## File: `src/app/actions/vendor-settings.ts`

### Match at line 29:
```typescript
        await vendorRef.set({
            storeInfo: {
                name: profileData.storeName,
                description: profileData.description,
                category: profileData.category,
                contactEmail: profileData.contactEmail,
                phone: profileData.phone,
                logo: profileData.logo || null,
                banner: profileData.banner || null,
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
```

### Match at line 65:
```typescript
        await vendorRef.set({
            paymentConfig: {
                bankName: paymentData.bankName,
                accountNumber: paymentData.accountNumber,
                accountName: paymentData.accountName,
                paymentSchedule: paymentData.paymentSchedule,
                minPayoutThreshold: paymentData.minPayoutThreshold,
                taxId: paymentData.taxId || null,
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
```

### Match at line 99:
```typescript
        await vendorRef.set({
            notifications: prefs,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
```

### Match at line 125:
```typescript
        await vendorRef.set({
            shipping: {
                locations: shippingData.locations,
                processingDays: shippingData.processingDays,
                returnPolicy: shippingData.returnPolicy,
                rates: shippingData.rates || {},
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
```

## File: `src/app/actions/vendor.ts`

### Match at line 217:
```typescript
        await productRef.update({
            stock: newStock,
            status,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 260:
```typescript
        await productRef.update({
            status: newStatus,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 298:
```typescript
        await productRef.update({
            status: "inactive",
            deletedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/actions/wave-admin.ts`

### Match at line 37:
```typescript
        const resourceRef = await db.collection("wave_resources").add({
            ...data,
            downloads: 0,
            uploadedAt: FieldValue.serverTimestamp(),
            uploadedBy: session.user.id,
        });
```

### Match at line 81:
```typescript
        await db.collection("wave_resources").doc(resourceId).update({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 156:
```typescript
        const eventRef = await db.collection("wave_training_events").add({
            ...data,
            currentParticipants: 0,
            status: "upcoming",
            createdAt: FieldValue.serverTimestamp(),
            createdBy: session.user.id,
        });
```

### Match at line 203:
```typescript
        await db.collection("wave_training_events").doc(eventId).update({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 308:
```typescript
        await appRef.update({
            status: "approved",
            approvedAt: FieldValue.serverTimestamp(),
            approvedBy: session.user.id,
        });
```

### Match at line 316:
```typescript
            await db.collection("wave_members").add({
                userId: appData.userId,
                enrolledAt: FieldValue.serverTimestamp(),
                active: true,
            });
```

### Match at line 395:
```typescript
        await appRef.update({
            status: "rejected",
            rejectedAt: FieldValue.serverTimestamp(),
            rejectedBy: session.user.id,
            rejectionReason: reason,
        });
```

## File: `src/app/actions/wave-member.ts`

### Match at line 154:
```typescript
            await db.collection("wave_resource_access").add({
                userId: session.user.id,
                resourceId,
                accessedAt: new Date(),
                accessCount: 1,
            });
```

### Match at line 163:
```typescript
            await accessDoc.ref.update({
                accessCount: FieldValue.increment(1),
                lastAccessedAt: new Date(),
            });
```

### Match at line 170:
```typescript
        await db.collection("wave_resources").doc(resourceId).update({
            downloads: FieldValue.increment(1),
        });
```

## File: `src/app/actions/wave.ts`

### Match at line 255:
```typescript
        await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).set({
            ...validatedData,
            age: calculatedAge, // Enforce truth: Save calculated age, not user input
            userId: session.user.id,
            userEmail: session.user.email || validatedData.email,
            status: "pending", // pending | approved | rejected
            applicationDate: FieldValue.serverTimestamp(),
            reviewedAt: null,
            reviewedBy: null,
            rejectionReason: null,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 269:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            "serviceRegistrations.wave.status": "pending",
            "serviceRegistrations.wave.applicationId": applicationId,
            "serviceRegistrations.wave.submittedAt": FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 326:
```typescript
        await db.collection("wave_members").doc(userId).set({
            enrolledAt: FieldValue.serverTimestamp(),
            active: true,
        }, { merge: true });
```

### Match at line 544:
```typescript
            await shipmentRef.update({
                status: latest.status,
                updates: updates, // Overwrite with authoritative history from carrier
                lastSyncedAt: FieldValue.serverTimestamp()
            });
```

### Match at line 816:
```typescript
        await resourceRef.update({
            downloads: FieldValue.increment(1)
        });
```

## File: `src/app/api/academy/certificate/generate/route.ts`

### Match at line 106:
```typescript
        await progressRef.update({
            certificateId: certificateRef.id,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/academy/quiz/submit/route.ts`

### Match at line 77:
```typescript
        await attemptRef.set({
            quizId,
            userId: session.user.id,
            courseId,
            attemptNumber,
            answers,
            score: scorePercentage,
            earnedPoints,
            totalPoints,
            passed,
            autoSubmit,
            completedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/admin/academy/quiz/create/route.ts`

### Match at line 41:
```typescript
        await quizRef.set({
            ...quizData,
            createdBy: session.user.id,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/admin/cooperative/approve-member/route.ts`

### Match at line 49:
```typescript
        await memberRef.update({
            membershipStatus: "approved",
            approvedBy: session.user.id,
            approvedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/admin/cooperative/create-loan-product/route.ts`

### Match at line 49:
```typescript
        await productRef.set({
            name,
            description,
            minAmount: Number(minAmount),
            maxAmount: Number(maxAmount),
            interestRate: Number(interestRate),
            durationMonths: Number(durationMonths),
            isActive: Boolean(isActive),
            createdAt: FieldValue.serverTimestamp(),
            createdBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/admin/cooperative/reject-loan/route.ts`

### Match at line 50:
```typescript
        await applicationRef.update({
            status: "rejected",
            rejectionReason: reason,
            rejectedAt: FieldValue.serverTimestamp(),
            rejectedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/admin/cooperative/reject-member/route.ts`

### Match at line 49:
```typescript
        await memberRef.update({
            membershipStatus: "suspended",
            rejectionReason: reason,
            rejectedBy: session.user.id,
            rejectedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/admin/cooperative/update-loan-product/route.ts`

### Match at line 66:
```typescript
        await productRef.update({
            name,
            description,
            minAmount: Number(minAmount),
            maxAmount: Number(maxAmount),
            interestRate: Number(interestRate),
            durationMonths: Number(durationMonths),
            isActive: Boolean(isActive),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: session.user.id,
        });
```

## File: `src/app/api/admin/farm-nation/approve-land/route.ts`

### Match at line 47:
```typescript
        await listingRef.update({
            verificationStatus: "verified",
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/admin/farm-nation/reject-land/route.ts`

### Match at line 47:
```typescript
        await listingRef.update({
            verificationStatus: "rejected",
            verificationNotes: reason,
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/admin/marketplace/approve-seller/route.ts`

### Match at line 64:
```typescript
        await verificationRef.update({
            status: "approved",
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 72:
```typescript
        await db.collection("marketplace_sellers").doc(verificationData.userId).update({
            verificationStatus: "approved",
            businessName: verificationData.businessName,
            rating: 0,
            totalSales: 0,
            approvedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/admin/marketplace/reject-seller/route.ts`

### Match at line 51:
```typescript
        await verificationRef.update({
            status: "rejected",
            rejectionReason: reason,
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 60:
```typescript
        await db.collection("marketplace_sellers").doc(verificationData.userId).update({
            verificationStatus: "rejected",
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/admin/marketplace/suspend-seller/route.ts`

### Match at line 51:
```typescript
        await verificationRef.update({
            status: "suspended",
            suspensionReason: reason,
            suspendedAt: FieldValue.serverTimestamp(),
            suspendedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 60:
```typescript
        await db.collection("marketplace_sellers").doc(verificationData.userId).update({
            verificationStatus: "suspended",
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/auth/mfa/disable/route.ts`

### Match at line 22:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            mfaEnabled: false,
            totpSecret: null,
            mfaRecoveryCodes: null,
            updatedAt: new Date(),
        });
```

## File: `src/app/api/auth/mfa/enable/route.ts`

### Match at line 68:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            mfaEnabled: true,
            updatedAt: new Date(),
        });
```

## File: `src/app/api/auth/mfa/setup/route.ts`

### Match at line 42:
```typescript
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            totpSecret: encryptedSecret,
            mfaEnabled: false,
            updatedAt: new Date(),
        });
```

## File: `src/app/api/certificates/upload/route.ts`

### Match at line 56:
```typescript
        await db.collection("user_certificates").add({
            userId: session.user.id,
            fileName: file.name,
            fileUrl,
            storagePath,
            fileType: file.type,
            uploadedBy: session.user.id,
            uploadedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/cooperative/verify-payment/route.ts`

### Match at line 119:
```typescript
        await membershipRef.update({
            paymentStatus: "completed",
            paymentVerifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            // Ensure savings/loan balances are initialized if not already
            savingsBalance: membershipData.savingsBalance || 0,
            loanBalance: membershipData.loanBalance || 0,
        });
```

## File: `src/app/api/cron/process-email-queue/route.ts`

### Match at line 90:
```typescript
                    await db.collection("email_queue").doc(doc.id).update({
                        status: "failed",
                        lastError: error.message,
                        failedAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    });
```

### Match at line 108:
```typescript
                    await db.collection("email_queue").doc(doc.id).update({
                        attempts: FieldValue.increment(1),
                        lastError: error.message,
                        nextRetry: nextRetry,
                        updatedAt: FieldValue.serverTimestamp()
                    });
```

## File: `src/app/api/farm-nation/create-listing/route.ts`

### Match at line 101:
```typescript
        await listingRef.set({
            userId,
            ownerName: userData.name || userData.email,
            title,
            category,
            description,
            state,
            lga,
            address,
            size,
            unit,
            pricePerUnit,
            totalPrice,
            gpsCoordinates,
            images,
            videoUrl,
            documents,
            availableForSale,
            availableForRent,
            escrowAvailable,
            verificationStatus: "pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/marketplace/create-product/route.ts`

### Match at line 73:
```typescript
        await productRef.set({
            sellerId: userId,
            sellerName: sellerData.businessName || session.user.name,
            name,
            category,
            description,
            specifications,
            unit,
            minOrder,
            stockQuantity,
            pricingTiers: {
                retail: retailPrice,
                bulk: bulkPrice || retailPrice,
                export: exportPrice || retailPrice,
            },
            certifications,
            images,
            videoUrl,
            escrowAvailable,
            rating: 0,
            totalOrders: 0,
            status: "active",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/marketplace/submit-verification/route.ts`

### Match at line 80:
```typescript
        await db.collection("seller_verifications").doc(userId).set({
            userId,
            businessName,
            businessType,
            businessDescription,
            phone,
            email,
            address,
            state,
            lga,
            documents: {
                businessDoc: `placeholder_${businessDoc.name}`,
                idDoc: `placeholder_${idDoc.name}`,
                addressProof: `placeholder_${addressProof.name}`,
            },
            bankDetails: {
                bankName,
                accountNumber,
                accountName,
            },
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
```

### Match at line 106:
```typescript
        await db.collection("marketplace_sellers").doc(userId).set({
            userId,
            verificationStatus: "pending",
            verificationId: userId,
            createdAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/marketplace/update-product/route.ts`

### Match at line 48:
```typescript
        await productRef.update({
            ...updateData,
            updatedAt: FieldValue.serverTimestamp(),
        });
```

## File: `src/app/api/onboarding/complete/route.ts`

### Match at line 27:
```typescript
            await userDocRef.set({
                id: session.user.id,
                email: session.user.email,
                onboardingCompleted: true,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
```

### Match at line 36:
```typescript
            await userDocRef.update({
                onboardingCompleted: true,
                updatedAt: FieldValue.serverTimestamp(),
            });
```

