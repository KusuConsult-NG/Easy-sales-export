
import React from 'react';
import { Page, Text, View, Document, StyleSheet, Image, Font } from '@react-pdf/renderer';

// Register fonts (using standard fonts for now to avoid loading external files in edge)
// In a real app, you'd register custom fonts here.

const styles = StyleSheet.create({
    page: {
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        padding: 40,
        alignItems: 'center',
    },
    border: {
        border: '4px solid #166534', // Green-800
        width: '100%',
        height: '100%',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
    },
    header: {
        marginBottom: 20,
        textAlign: 'center',
    },
    title: {
        fontSize: 36,
        fontWeight: 'bold',
        color: '#166534',
        marginBottom: 10,
        textTransform: 'uppercase',
    },
    subtitle: {
        fontSize: 14,
        color: '#4b5563',
        marginBottom: 30,
    },
    recipient: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#000000',
        marginBottom: 10,
        textAlign: 'center',
        borderBottom: '1px solid #9ca3af',
        paddingBottom: 5,
        minWidth: 300,
    },
    text: {
        fontSize: 14,
        color: '#374151',
        marginBottom: 10,
        textAlign: 'center',
    },
    courseTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#15803d', // Green-700
        marginBottom: 20,
        textAlign: 'center',
    },
    metadata: {
        marginTop: 40,
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '80%',
    },
    col: {
        alignItems: 'center',
    },
    label: {
        fontSize: 10,
        color: '#6b7280',
        marginBottom: 4,
    },
    value: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    footer: {
        position: 'absolute',
        bottom: 30,
        fontSize: 10,
        color: '#9ca3af',
        textAlign: 'center',
    },
    id: {
        fontSize: 10,
        color: '#9ca3af',
        marginTop: 10,
    }
});

interface CertificateProps {
    studentName: string;
    courseTitle: string;
    completionDate: string;
    certificateId: string;
    instructor: string;
}

export const CertificateDocument = ({ studentName, courseTitle, completionDate, certificateId, instructor }: CertificateProps) => (
    <Document>
        <Page size="A4" orientation="landscape" style={styles.page}>
            <View style={styles.border}>
                <View style={styles.header}>
                    <Text style={styles.title}>Certificate of Completion</Text>
                    <Text style={styles.subtitle}>Easy Sales Export Academy</Text>
                </View>

                <Text style={styles.text}>This is to certify that</Text>
                <Text style={styles.recipient}>{studentName}</Text>
                <Text style={styles.text}>has successfully completed the course</Text>
                <Text style={styles.courseTitle}>{courseTitle}</Text>

                <View style={styles.metadata}>
                    <View style={styles.col}>
                        <Text style={styles.label}>Instructor</Text>
                        <Text style={styles.value}>{instructor}</Text>
                    </View>
                    <View style={styles.col}>
                        <Text style={styles.label}>Date Completed</Text>
                        <Text style={styles.value}>{completionDate}</Text>
                    </View>
                </View>

                <View style={styles.footer}>
                    <Text>Verify at: https://easysalesexport.com/verify/{certificateId}</Text>
                    <Text style={styles.id}>ID: {certificateId}</Text>
                </View>
            </View>
        </Page>
    </Document>
);
