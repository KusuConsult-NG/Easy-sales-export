import { z } from 'zod';

// Course Progress Update Schema
export const courseProgressSchema = z.object({
    courseId: z.string().min(1, 'Course ID is required'),
    lessonId: z.string().min(1, 'Lesson ID is required'),
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

// Create Course Schema
export const createCourseSchema = z.object({
    title: z.string().min(5, "Title must be at least 5 characters"),
    description: z.string().min(20, "Description must be at least 20 characters"),
    instructor: z.string().min(2, "Instructor name is required"),
    duration: z.string().min(1, "Duration is required"), // e.g., "4 weeks"
    level: z.enum(["beginner", "intermediate", "advanced"]),
    price: z.number().min(0, "Price cannot be negative"),
    thumbnail: z.string().url("Invalid thumbnail URL").optional().or(z.literal("")),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
