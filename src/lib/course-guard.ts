/**
 * Deleting a course removes everything that hangs from it in the database (questions, enrolments,
 * content, requests…). So the website dashboard deletes a course only when nothing hangs from it;
 * otherwise it is hidden by switching "published" off.
 * (The five exam folders every course gets automatically do not count.)
 */
import type { Prisma, PrismaClient } from "@prisma/client";

const KINDS = [
  { key: "questions", ar: "أسئلة", en: "questions" },
  { key: "scenarios", ar: "سيناريوهات", en: "case scenarios" },
  { key: "categories", ar: "تصنيفات", en: "categories" },
  { key: "assets", ar: "مرفقات أسئلة", en: "question attachments" },
  { key: "exams", ar: "اختبارات", en: "tests" },
  { key: "enrollments", ar: "متدربون مسجلون", en: "enrolments" },
  { key: "trainers", ar: "مدربون مسندون", en: "assigned trainers" },
  { key: "folders", ar: "مجلدات محتوى", en: "content folders" },
  { key: "content", ar: "ملفات وفيديوهات", en: "files and videos" },
  { key: "registrations", ar: "طلبات تسجيل", en: "registration requests" },
  { key: "sessions", ar: "مواعيد", en: "scheduled dates" },
] as const;

export type CourseDependent = { key: (typeof KINDS)[number]["key"]; ar: string; en: string; count: number };

/** what would be lost with the course; empty = safe to delete */
export async function courseDependents(db: PrismaClient | Prisma.TransactionClient, programId: string): Promise<CourseDependent[]> {
  const where = { programId };
  const counts: Record<CourseDependent["key"], number> = {
    questions: await db.question.count({ where }),
    scenarios: await db.scenario.count({ where }),
    categories: await db.questionCategory.count({ where }),
    assets: await db.examAsset.count({ where }),
    exams: await db.exam.count({ where }),
    enrollments: await db.enrollment.count({ where }),
    trainers: await db.courseInstructor.count({ where }),
    folders: await db.courseFolder.count({ where }),
    // items of this course, and nothing of other courses
    content: await db.courseItem.count({ where }),
    registrations: await db.registration.count({ where }),
    sessions: await db.courseSession.count({ where }),
  };
  return KINDS.filter((k) => counts[k.key] > 0).map((k) => ({ ...k, count: counts[k.key] }));
}
