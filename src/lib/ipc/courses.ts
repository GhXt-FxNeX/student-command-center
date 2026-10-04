import { invoke } from "@tauri-apps/api/core";
import type { Course, NewSubject, Subject, SubjectScheduleEntry, WeekdayName } from "@/types";

export function listCourses(): Promise<Course[]> {
  return invoke("list_courses");
}

export function createCourse(name: string, color: string): Promise<Course> {
  return invoke("create_course", { name, color });
}

/** Phase 14 (Courses tab). */
export function updateCourse(id: number, name: string, color: string, archived: boolean): Promise<Course> {
  return invoke("update_course", { id, name, color, archived });
}

/** Cascades to the course's subjects and their weekly schedules. Tasks/
 * exams tagged with this course keep existing but lose the tag rather
 * than being deleted. */
export function deleteCourse(id: number): Promise<void> {
  return invoke("delete_course", { id });
}

/** Omit courseId (or pass null) to list subjects across all courses. */
export function listSubjects(courseId?: number | null): Promise<Subject[]> {
  return invoke("list_subjects", { courseId: courseId ?? null });
}

export function createSubject(subject: NewSubject): Promise<Subject> {
  return invoke("create_subject", { subject });
}

/** Phase 14 (Courses tab). */
export function updateSubject(id: number, name: string, color: string | null): Promise<Subject> {
  return invoke("update_subject", { id, name, color });
}

/** Cascades to the subject's weekly schedule. */
export function deleteSubject(id: number): Promise<void> {
  return invoke("delete_subject", { id });
}

// ---- Recurring weekly class schedule (Phase 14) ----

export function listWeeklySchedule(subjectId: number): Promise<SubjectScheduleEntry[]> {
  return invoke("list_weekly_schedule", { subjectId });
}

/** Sets (or replaces) this subject's class time for one day — every day
 * is independent, so times can differ freely day to day. */
export function setWeeklyScheduleDay(
  subjectId: number,
  dayOfWeek: WeekdayName,
  startTime: string,
  endTime: string | null
): Promise<SubjectScheduleEntry> {
  return invoke("set_weekly_schedule_day", { subjectId, dayOfWeek, startTime, endTime });
}

/** Clears a subject's class time for one day ("no class this day"). */
export function removeWeeklyScheduleDay(subjectId: number, dayOfWeek: WeekdayName): Promise<void> {
  return invoke("remove_weekly_schedule_day", { subjectId, dayOfWeek });
}
