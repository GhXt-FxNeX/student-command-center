import { invoke } from "@tauri-apps/api/core";
import type { NewStudySession, StudySession } from "@/types";

export function createStudySession(session: NewStudySession): Promise<StudySession> {
  return invoke("create_study_session", { session });
}

export function completePomodoroSession(
  workMinutes: number,
  breakMinutes: number,
  taskId: number | null,
  courseId: number | null,
  subjectId: number | null
): Promise<StudySession> {
  return invoke("complete_pomodoro_session", {
    workMinutes,
    breakMinutes,
    taskId,
    courseId,
    subjectId,
  });
}
