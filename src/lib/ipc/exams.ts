import { invoke } from "@tauri-apps/api/core";
import type { Exam, ExamStats, NewExam } from "@/types";

export function listExams(): Promise<Exam[]> {
  return invoke("list_exams");
}

export function createExam(exam: NewExam): Promise<Exam> {
  return invoke("create_exam", { exam });
}

export function updateExam(id: number, exam: NewExam): Promise<Exam> {
  return invoke("update_exam", { id, exam });
}

export function deleteExam(id: number): Promise<void> {
  return invoke("delete_exam", { id });
}

export function getExamStats(): Promise<ExamStats> {
  return invoke("get_exam_stats");
}
