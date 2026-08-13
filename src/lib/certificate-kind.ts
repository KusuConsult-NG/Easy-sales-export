/**
 * Telling an issued credential apart from a file somebody uploaded.
 *
 * WHY THIS EXISTS
 * ---------------
 * `COLLECTIONS.CERTIFICATES` holds two unrelated kinds of record:
 *
 *   ACADEMY-ISSUED   written by /api/academy/certificate/generate after a
 *                    course is completed. Carries userName, courseId,
 *                    courseTitle, grade, completionDate. This is a credential
 *                    the platform vouches for.
 *
 *   USER-UPLOADED    written by uploadCertificateAction — a PDF or image the
 *                    user attached to their own profile. Carries fileName,
 *                    fileUrl, fileType, size. The platform has verified nothing
 *                    about it beyond its file type.
 *
 * Three readers treated every row as the first kind:
 *
 *   /api/academy/verify/[certificateId]  a PUBLIC endpoint that fetched any
 *                                        document by id and answered
 *                                        `isValid: true`. Since
 *                                        uploadCertificateAction returns the new
 *                                        document's id to whoever uploaded it,
 *                                        anyone could upload a file and have the
 *                                        platform publicly verify its id as a
 *                                        certificate.
 *
 *   /api/academy/dashboard               counted every row for the user as
 *                                        `certificatesEarned`, so uploading
 *                                        files inflated the figure.
 *
 *   deleteCertificateAction              would delete an issued credential
 *                                        through the attach-a-document endpoint.
 *
 * `recordType` is written by both writers now. Rows created before this change
 * have none, so the predicate falls back to the shape that has always
 * distinguished them: an issued certificate has a courseId and an uploaded file
 * does not. It fails closed — a row that is neither is not treated as issued.
 */

export const ACADEMY_CERTIFICATE = "academy_certificate";
export const USER_UPLOADED_DOCUMENT = "user_upload";

/**
 * Is this row a credential the platform issued?
 *
 * Only these may be publicly verified or counted as earned.
 */
export function isIssuedCertificate(data: Record<string, any> | undefined | null): boolean {
    if (!data) return false;
    if (data.recordType === ACADEMY_CERTIFICATE) return true;
    if (data.recordType === USER_UPLOADED_DOCUMENT) return false;

    // Legacy rows, written before recordType existed. An issued certificate
    // always has a courseId; an uploaded document never does.
    return typeof data.courseId === "string" && data.courseId.length > 0;
}

/** Is this row a document the user attached themselves? */
export function isUserUploadedDocument(data: Record<string, any> | undefined | null): boolean {
    if (!data) return false;
    if (data.recordType === USER_UPLOADED_DOCUMENT) return true;
    if (data.recordType === ACADEMY_CERTIFICATE) return false;

    // Legacy rows: an uploaded document always has a fileUrl and no courseId.
    return !isIssuedCertificate(data) && typeof data.fileUrl === "string";
}
