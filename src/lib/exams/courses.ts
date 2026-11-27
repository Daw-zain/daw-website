"use client";

/** Course management — browser types and file helpers. Every rule is checked again in the database. */
import { supabase } from "@/lib/static/supabase";
import { ExamError, rpc } from "./client";

export const FILES_BUCKET = "course-files";
export const COVERS_BUCKET = "course-covers";
export const FILE_MAX = 50 * 1024 * 1024;
export const COVER_MAX = 3 * 1024 * 1024;

/** extension → content type: some browsers report no type for office files */
export const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};
export const VIDEO_EXTENSIONS = ["mp4", "webm"];
/** types a browser can show inside the page; only these may be "view only" */
export const previewable = (mime: string) => ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm", "audio/mpeg"].includes(mime);
export const extensionOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

export type Section = "MATERIAL" | "VIDEO";
export type VideoSource = "YOUTUBE" | "VIMEO" | "LINK" | "FILE";
export type ItemProgress = { percent: number; completed: boolean; positionSec: number; ranges: [number, number][]; durationSec: number | null };
export type CourseFolder = { id: string; section: Section; nameAr: string; nameEn: string; published: boolean; sortOrder: number };
export type CourseItem = {
  id: string;
  programId: string;
  section: Section;
  folderId: string | null;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  sortOrder: number;
  allowDownload: boolean;
  source: VideoSource;
  url: string;
  videoRef: string;
  filePath: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  updatedAt: string;
  progress: ItemProgress | null;
  // staff only
  published?: boolean;
  sharedWith?: string[];
  version?: number;
  versions?: { version: number; fileName: string; filePath: string; size: number; replacedAt: string }[];
  /** set on items another course shared with this one */
  fromCode?: string;
};
export type CourseProgress = { total: number; done: number; percent: number; lastAt: string | null };
export type CourseContent = {
  canManage: boolean;
  staff: boolean;
  canSeeProgress: boolean;
  progress: CourseProgress;
  folders: CourseFolder[];
  items: CourseItem[];
  shared: CourseItem[];
  courses: { programId: string; code: string; titleAr: string; titleEn: string }[];
};
export type ContentReport = {
  trainees: { id: string; name: string; email: string; open: boolean; progress: CourseProgress; videoSeconds: number }[];
  items: { id: string; section: Section; titleAr: string; titleEn: string; published: boolean; openedBy: number; completedBy: number; avgPercent: number }[];
};

export type CourseSummary = {
  programId: string;
  slug: string;
  code: string | null;
  titleAr: string;
  titleEn: string;
  category: string;
  status: string;
  published: boolean;
  image: string | null;
  files: number;
  videos: number;
  questions: number;
  exams: number;
  trainees: number;
  trainers: number;
};
export type CourseData = Record<string, string | number | boolean | null> & { id: string; slug: string; titleAr: string; titleEn: string; published: boolean; image: string | null; code: string | null };
export type CourseRecord = {
  course: CourseData;
  can: { update: boolean; content: boolean; trainers: boolean; tests: boolean };
  trainers: { id: string; name: string; email: string; active: boolean; canManageContent: boolean }[];
  trainees: number;
  candidates: { email: string; name: string }[];
};

export const itemTitle = (x: { titleAr: string; titleEn: string }, locale: string) => (locale === "ar" ? x.titleAr || x.titleEn : x.titleEn || x.titleAr);
export const itemDesc = (x: { descAr: string; descEn: string }, locale: string) => (locale === "ar" ? x.descAr || x.descEn : x.descEn || x.descAr);
export const folderName = (x: { nameAr: string; nameEn: string }, locale: string) => (locale === "ar" ? x.nameAr || x.nameEn : x.nameEn || x.nameAr);
export const fileSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** the code of a failure, for the dictionary of course messages */
export function courseErrorKey(e: unknown): string {
  if (e instanceof FileError) return e.code;
  if (e instanceof ExamError) return e.message.match(/invalid_(?:content|course): ([a-z_0-9]+)/)?.[1] ?? e.code;
  return "unknown";
}
export class FileError extends Error {
  constructor(public code: "bad_type" | "too_big" | "upload_failed" | "video_type" | "cover_type" | "cover_big") {
    super(code);
  }
}

export type StoredFile = { filePath: string; fileName: string; mimeType: string; size: number };

/** checks a chosen file, then uploads it under the course's folder in the private bucket */
export async function uploadCourseFile(programId: string, file: File, video: boolean): Promise<StoredFile> {
  const ext = extensionOf(file.name);
  const mimeType = FILE_TYPES[ext];
  if (!mimeType) throw new FileError("bad_type");
  if (video && !VIDEO_EXTENSIONS.includes(ext)) throw new FileError("video_type");
  if (file.size > FILE_MAX || file.size <= 0) throw new FileError("too_big");
  const filePath = `${programId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase().storage.from(FILES_BUCKET).upload(filePath, file.slice(0, file.size, mimeType), { contentType: mimeType, upsert: false });
  if (error) throw new FileError(/size/i.test(error.message) ? "too_big" : /mime/i.test(error.message) ? "bad_type" : "upload_failed");
  return { filePath, fileName: file.name.slice(0, 200), mimeType, size: file.size };
}

export async function removeCourseFiles(paths: string[]) {
  if (paths.length) await supabase().storage.from(FILES_BUCKET).remove(paths);
}

/** stores the file, then records it; a file whose record is refused does not stay behind */
export async function saveWithFile<T>(programId: string, file: File, video: boolean, save: (f: StoredFile) => Promise<T>): Promise<T> {
  const stored = await uploadCourseFile(programId, file, video);
  try {
    return await save(stored);
  } catch (e) {
    await removeCourseFiles([stored.filePath]).catch(() => {});
    throw e;
  }
}

/** a link that expires; with `downloadAs` the browser saves the file instead of showing it */
export async function courseFileUrl(path: string, seconds: number, downloadAs?: string): Promise<string> {
  const { data, error } = await supabase().storage.from(FILES_BUCKET).createSignedUrl(path, seconds, downloadAs ? { download: downloadAs } : undefined);
  if (error || !data?.signedUrl) throw new FileError("upload_failed");
  return data.signedUrl;
}

/** uploads a course cover to the public bucket and returns its address */
export async function uploadCover(programId: string, file: File): Promise<string> {
  const ext = extensionOf(file.name);
  if (!["png", "jpg", "jpeg", "webp"].includes(ext)) throw new FileError("cover_type");
  if (file.size > COVER_MAX) throw new FileError("cover_big");
  const path = `${programId}/${crypto.randomUUID()}.${ext}`;
  const bucket = supabase().storage.from(COVERS_BUCKET);
  const { error } = await bucket.upload(path, file, { contentType: FILE_TYPES[ext], upsert: false });
  if (error) throw new FileError("upload_failed");
  return bucket.getPublicUrl(path).data.publicUrl;
}

export const loadContent = (programId: string) => rpc<CourseContent>("exam_content", { p_program: programId });
