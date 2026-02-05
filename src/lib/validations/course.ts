import { z } from 'zod';

// Course Progress Update Schema
export const courseProgressSchema = z.object({
    courseId: z.string().min(1, 'Course ID is required'),
    progressPercent: z.number().min(0).max(100),
    lastWatchedSecond: z.number().min(0),
    completed: z.boolean().optional(),
});

export type CourseProgressInput = z.infer<typeof courseProgressSchema>;

// Course Enrollment Schema
export const courseEnrollmentSchema = z.object({
    courseId: z.string().min(1, 'Course ID is required'),
});

export type CourseEnrollmentInput = z.infer<typeof courseEnrollmentSchema>;
