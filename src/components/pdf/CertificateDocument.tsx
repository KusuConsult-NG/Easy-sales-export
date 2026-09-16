
import { academyVerificationPath } from "@/lib/academy-certificate";
import { brandLogoDataUri } from "@/lib/brand-logo";
import { CREDENTIAL_BRAND, CREDENTIAL_GRADIENT } from "@/lib/credential-brand";
import React from 'react';
import {
    Page, Text, View, Document, StyleSheet, Image,
    Svg, Defs, LinearGradient, Stop, Rect,
} from '@react-pdf/renderer';

/*
 *   #808 THE CERTIFICATE WAS NOT THE CREDENTIAL IT BELONGS BESIDE.
 *
 *   The owner asked for the certificate to carry the same branding as the
 *   membership ID card. It did not. This document's every accent was #7C3AED,
 *   a violet that appears on NO other credential-bearing surface — while the
 *   ID card has always been a purple-to-indigo gradient, and a second,
 *   orphaned certificate document was emerald. Three schemes, two credentials.
 *
 *   A first pass at this recoloured the certificate to the app's blue
 *   (`--primary`, #2E519F), reasoning from the logo rather than from the other
 *   credential. The owner's answer was that the purple version was better —
 *   which was the correct call and the useful correction: the printed
 *   credentials are a deliberate family of their own, and the certificate's
 *   job is to look like the ID card in somebody's wallet, not like the
 *   website.
 *
 *   EVERY COLOUR BELOW NOW COMES FROM lib/credential-brand, which holds the
 *   values extracted from the ID card itself. Hard-coding a matching hex here
 *   would have been the same defect one shade further on: two files that agree
 *   today and drift on the next edit.
 */

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    page: {
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        padding: 36,
        alignItems: 'center',
        fontFamily: 'Helvetica',
    },
    // Outer border, in the ID card's dominant purple
    outerBorder: {
        border: `3px solid ${CREDENTIAL_BRAND.purple}`,
        width: '100%',
        height: '100%',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        /*
         *   Centred vertically because the rendered document was top-heavy:
         *   everything sat in the upper two thirds with a band of empty white
         *   below the footer, which reads as a page that lost something rather
         *   than a certificate. Only visible by rendering it and looking.
         */
        justifyContent: 'center',
        position: 'relative',
    },
    /*
     *   THE ID CARD'S GRADIENT, AS A GRADIENT.
     *
     *   The card's most recognisable feature is its purple→indigo sweep, and
     *   flattening it to one accent would have matched the card's COLOUR while
     *   losing the thing somebody actually recognises.
     *
     *   The first attempt drew it as three flat segments, on the assumption
     *   that @react-pdf had no dependable gradient. RENDERED AND LOOKED AT, it
     *   was three hard-edged blocks — visibly not the card. @react-pdf 4.3.2
     *   does export Svg/Defs/LinearGradient/Stop, so the stripes are a real
     *   gradient carrying the card's own three stops at the card's own offsets.
     */
    topStripe: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 8,
    },
    bottomStripe: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 8,
    },
    logo: {
        width: 140,
        height: 60,
        marginBottom: 10,
        objectFit: 'contain',
    },
    orgName: {
        fontSize: 12,
        color: CREDENTIAL_BRAND.purpleDeep,
        letterSpacing: 2,
        textTransform: 'uppercase',
        fontFamily: 'Helvetica-Bold',
        marginBottom: 12,
    },
    title: {
        fontSize: 34,
        fontFamily: 'Helvetica-Bold',
        color: CREDENTIAL_BRAND.indigo,
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    divider: {
        width: 120,
        height: 2,
        backgroundColor: CREDENTIAL_BRAND.purple,
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
        color: CREDENTIAL_BRAND.purpleDeep,
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

/**
 * A bar carrying the membership card's purple→indigo sweep.
 *
 * The stops and their offsets are the card's, taken from CREDENTIAL_GRADIENT
 * rather than respelled here — including the 40% midpoint, which is what gives
 * the card its weighting toward purple rather than an even three-way blend.
 *
 * @param id must be unique per document: two gradients sharing an id collapse
 *           to whichever was defined last.
 */
const GradientBar = ({ id }: { id: string }) => (
    <Svg width="100%" height={8} viewBox="0 0 100 8" preserveAspectRatio="none">
        <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={CREDENTIAL_GRADIENT[0]} />
                <Stop offset="0.4" stopColor={CREDENTIAL_GRADIENT[1]} />
                <Stop offset="1" stopColor={CREDENTIAL_GRADIENT[2]} />
            </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="8" fill={`url(#${id})`} />
    </Svg>
);

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
}: CertificateProps) => {
    const logoSrc = brandLogoDataUri();

    return (
    <Document>
        <Page size="A4" orientation="landscape" style={styles.page}>
            <View style={styles.outerBorder}>
                {/*
                  *   Accent stripes, each the ID card's own gradient. The Svg
                  *   child is REQUIRED, not decorative: the stripe Views carry
                  *   no background of their own, so dropping it leaves two
                  *   invisible bars rather than two purple ones.
                  */}
                <View style={styles.topStripe}><GradientBar id="topBar" /></View>
                <View style={styles.bottomStripe}><GradientBar id="bottomBar" /></View>

                {/*
                  *   #809 THE LOGO IS READ FROM DISK, NOT FETCHED OVER HTTP.
                  *
                  *   This was `src={`${baseUrl}/images/logo.jpg`}` — the server
                  *   opening an HTTP connection to its own public hostname to
                  *   collect a file already on its disk, at the moment somebody
                  *   finishes a course.
                  *
                  *   AND THE FAILURE WAS SILENT. Measured, rendering the same
                  *   one-image document four ways:
                  *
                  *       local path     OK  57,018 bytes
                  *       data URI       OK  57,018 bytes
                  *       remote URL     OK   1,215 bytes   <- no image
                  *
                  *   The remote attempt DID NOT THROW. @react-pdf logs "Not
                  *   valid image extension" and renders the page anyway, so a
                  *   failed fetch produced a certificate with no logo — issued,
                  *   stored and handed over with a blank space where the
                  *   company's mark belongs, and nothing to say so.
                  *
                  *   The owner found it on a sample and asked why.
                  *
                  *   Rendered only when the bytes are there: a document that
                  *   draws nothing beats one that draws a broken-image box, and
                  *   lib/brand-logo logs the reason either way.
                  */}
                {logoSrc && (
                    // eslint-disable-next-line jsx-a11y/alt-text
                    <Image src={logoSrc} style={styles.logo} />
                )}
                
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
                    {/*   #636 `/verify/{id}` is not a route. The verifier is at
                          /academy/verify, and the host comes from the request the
                          PDF was generated for rather than from a literal — this
                          platform serves www.easysalesexport.com. */}
                    Verify at: {baseUrl}{academyVerificationPath(certificateId)}
                </Text>
            </View>
        </Page>
    </Document>
    );
};
