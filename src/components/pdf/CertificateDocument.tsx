
import React from 'react';
import { Page, Text, View, Document, StyleSheet, Image } from '@react-pdf/renderer';

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    page: {
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        padding: 36,
        alignItems: 'center',
        fontFamily: 'Helvetica',
    },
    // Outer gold border
    outerBorder: {
        border: '3px solid #7C3AED',
        width: '100%',
        height: '100%',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
    },
    // Accent top stripe
    topStripe: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 8,
        backgroundColor: '#7C3AED',
    },
    bottomStripe: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 8,
        backgroundColor: '#7C3AED',
    },
    logo: {
        width: 140,
        height: 60,
        marginBottom: 10,
        objectFit: 'contain',
    },
    orgName: {
        fontSize: 12,
        color: '#6D28D9',
        letterSpacing: 2,
        textTransform: 'uppercase',
        fontFamily: 'Helvetica-Bold',
        marginBottom: 12,
    },
    title: {
        fontSize: 34,
        fontFamily: 'Helvetica-Bold',
        color: '#1E1B4B',
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    divider: {
        width: 120,
        height: 2,
        backgroundColor: '#7C3AED',
        marginBottom: 16,
    },
    subtitle: {
        fontSize: 13,
        color: '#6B7280',
        marginBottom: 8,
    },
    recipient: {
        fontSize: 30,
        fontFamily: 'Helvetica-Bold',
        color: '#111827',
        marginBottom: 8,
        textAlign: 'center',
        borderBottom: '1.5px solid #D1D5DB',
        paddingBottom: 4,
        minWidth: 320,
    },
    text: {
        fontSize: 13,
        color: '#374151',
        marginBottom: 8,
        textAlign: 'center',
    },
    courseTitle: {
        fontSize: 22,
        fontFamily: 'Helvetica-Bold',
        color: '#7C3AED',
        marginBottom: 20,
        textAlign: 'center',
    },
    metadata: {
        marginTop: 20,
        flexDirection: 'row',
        justifyContent: 'space-around',
        width: '85%',
        borderTop: '1px solid #E5E7EB',
        paddingTop: 16,
    },
    col: {
        alignItems: 'center',
    },
    sigLine: {
        width: 130,
        height: 1,
        backgroundColor: '#9CA3AF',
        marginBottom: 4,
    },
    label: {
        fontSize: 9,
        color: '#6B7280',
        marginBottom: 3,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    value: {
        fontSize: 11,
        fontFamily: 'Helvetica-Bold',
        color: '#1F2937',
    },
    footer: {
        marginTop: 12,
        fontSize: 9,
        color: '#9CA3AF',
        textAlign: 'center',
    },
    certId: {
        fontSize: 9,
        color: '#9CA3AF',
        marginTop: 2,
        fontFamily: 'Helvetica-Oblique',
    }
});

interface CertificateProps {
    studentName: string;
    courseTitle: string;
    completionDate: string;
    certificateId: string;
    instructor: string;
    baseUrl: string;
}

export const CertificateDocument = ({
    studentName,
    courseTitle,
    completionDate,
    certificateId,
    instructor,
    baseUrl
}: CertificateProps) => (
    <Document>
        <Page size="A4" orientation="landscape" style={styles.page}>
            <View style={styles.outerBorder}>
                {/* Accent stripes */}
                <View style={styles.topStripe} />
                <View style={styles.bottomStripe} />

                {/* Logo */}
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={`${baseUrl}/images/logo.jpg`} style={styles.logo} />
                
                <Text style={styles.orgName}>EASY SALES EXPORT LTD</Text>

                {/* Title */}
                <Text style={styles.title}>Certificate of Completion</Text>
                <View style={styles.divider} />

                {/* Body */}
                <Text style={styles.subtitle}>This is to certify that</Text>
                <Text style={styles.recipient}>{studentName}</Text>
                <Text style={styles.text}>has successfully completed the course</Text>
                <Text style={styles.courseTitle}>{courseTitle}</Text>

                {/* Meta row */}
                <View style={styles.metadata}>
                    <View style={styles.col}>
                        <View style={styles.sigLine} />
                        <Text style={styles.label}>Instructor</Text>
                        <Text style={styles.value}>{instructor}</Text>
                    </View>
                    <View style={styles.col}>
                        <View style={styles.sigLine} />
                        <Text style={styles.label}>Date Completed</Text>
                        <Text style={styles.value}>{completionDate}</Text>
                    </View>
                    <View style={styles.col}>
                        <View style={styles.sigLine} />
                        <Text style={styles.label}>Certificate ID</Text>
                        <Text style={styles.value}>{certificateId}</Text>
                    </View>
                </View>

                {/* Footer */}
                <Text style={styles.footer}>
                    Easy Sales Export Academy  •  easysalesexport.com
                </Text>
                <Text style={styles.certId}>
                    Verify at: https://easysalesexport.com/verify/{certificateId}
                </Text>
            </View>
        </Page>
    </Document>
);
