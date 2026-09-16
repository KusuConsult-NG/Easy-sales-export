"use client";

import { academyVerificationPath } from "@/lib/academy-certificate";
import { CREDENTIAL_BRAND } from "@/lib/credential-brand";
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useToast } from "@/contexts/ToastContext";

// Styles for certificate
const styles = StyleSheet.create({
    page: {
        backgroundColor: '#ffffff',
        padding: 60,
        fontFamily: 'Helvetica',
    },
    border: {
        border: `8px solid ${CREDENTIAL_BRAND.purple}`,
        borderRadius: 8,
        padding: 40,
        height: '100%',
    },
    header: {
        fontSize: 36,
        textAlign: 'center',
        color: CREDENTIAL_BRAND.purpleDeep,
        fontWeight: 'bold',
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 2,
    },
    subheader: {
        fontSize: 16,
        textAlign: 'center',
        color: '#64748b',
        marginBottom: 40,
    },
    body: {
        fontSize: 14,
        textAlign: 'center',
        marginTop: 30,
        color: '#475569',
    },
    name: {
        fontSize: 32,
        fontWeight: 'bold',
        textAlign: 'center',
        marginVertical: 25,
        color: '#0f172a',
        borderBottom: `2px solid ${CREDENTIAL_BRAND.purple}`,
        paddingBottom: 10,
    },
    courseName: {
        fontSize: 22,
        textAlign: 'center',
        marginVertical: 20,
        color: CREDENTIAL_BRAND.purpleDeep,
        fontWeight: 'bold',
    },
    date: {
        fontSize: 12,
        textAlign: 'center',
        color: '#64748b',
        marginTop: 30,
    },
    footer: {
        position: 'absolute',
        bottom: 40,
        left: 60,
        right: 60,
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderTop: '1px solid #e2e8f0',
        paddingTop: 15,
    },
    signature: {
        fontSize: 10,
        color: '#64748b',
        textAlign: 'center',
    },
    certificateId: {
        fontSize: 8,
        color: '#94a3b8',
        textAlign: 'center',
        marginTop: 5,
    },
});

// Certificate Document Component
/*
 *   #808 AND THIS SECOND CERTIFICATE WAS GREEN.
 *
 *   The platform has TWO certificate documents: the one the live route renders
 *   (components/pdf/CertificateDocument) and this one, which #430 identified as
 *   belonging to "an orphaned component" — it has no callers anywhere in
 *   src/app. So the platform carried two certificate designs in two different
 *   colours, and NEITHER was the company's.
 *
 *   Recoloured rather than left alone because it costs nothing and closes the
 *   drift: if this is ever wired up it matches the certificate the platform
 *   actually issues, instead of being emerald. It is NOT
 *   merged into the live document here — that is a real refactor of a dead path
 *   and a decision for the owner, not something to slip into a colour change.
 */
const CertificateDocument = ({
    userName,
    courseName,
    completionDate,
    certificateId,
    courseDuration,
    instructor
}: {
    userName: string;
    courseName: string;
    completionDate: string;
    certificateId: string;
    courseDuration?: string;
    instructor?: string;
}) => (
    <Document>
        <Page size="A4" orientation="landscape" style={styles.page}>
            <View style={styles.border}>
                <Text style={styles.header}>Certificate of Completion</Text>
                <Text style={styles.subheader}>Easy Sales Export Academy</Text>

                <Text style={styles.body}>This is to certify that</Text>
                <Text style={styles.name}>{userName}</Text>

                <Text style={styles.body}>has successfully completed</Text>
                <Text style={styles.courseName}>{courseName}</Text>

                {courseDuration && (
                    <Text style={styles.body}>Duration: {courseDuration}</Text>
                )}

                <Text style={styles.date}>Awarded on {completionDate}</Text>

                <View style={styles.footer}>
                    <View>
                        <Text style={styles.signature}>_____________________</Text>
                        <Text style={styles.signature}>{instructor || 'Academy Director'}</Text>
                    </View>
                    <View>
                        <Text style={styles.certificateId}>Certificate ID: {certificateId}</Text>
                        <Text style={styles.certificateId}>easysalesexport.com{academyVerificationPath(certificateId)}</Text>
                    </View>
                    <View>
                        <Text style={styles.signature}>_____________________</Text>
                        <Text style={styles.signature}>Platform Director</Text>
                    </View>
                </View>
            </View>
        </Page>
    </Document>
);

// Main Component
interface CertificateGeneratorProps {
    userName: string;
    courseName: string;
    completionDate?: string;
    courseDuration?: string;
    instructor?: string;
    courseId?: string;
}

export default function CertificateGenerator({
    userName,
    courseName,
    completionDate,
    courseDuration,
    instructor,
    courseId
}: CertificateGeneratorProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const { showToast } = useToast();

    const downloadCertificate = async () => {
        setIsGenerating(true);
        try {
            const certificateId = `CERT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
            const date = completionDate || new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            const blob = await pdf(
                <CertificateDocument
                    userName={userName}
                    courseName={courseName}
                    completionDate={date}
                    certificateId={certificateId}
                    courseDuration={courseDuration}
                    instructor={instructor}
                />
            ).toBlob();

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `certificate-${courseId || courseName.toLowerCase().replace(/\s+/g, '-')}.pdf`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            console.error('Failed to generate certificate:', error);
            showToast('Failed to generate certificate. Please try again.', "error");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <button
            onClick={downloadCertificate}
            disabled={isGenerating}
            className="flex items-center gap-2 px-6 py-3 bg-linear-to-r from-green-600 to-green-500 text-white rounded-lg hover:from-green-700 hover:to-green-600 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
        >
            <Download className="w-5 h-5" />
            {isGenerating ? 'Generating Certificate...' : 'Download Certificate'}
        </button>
    );
}
