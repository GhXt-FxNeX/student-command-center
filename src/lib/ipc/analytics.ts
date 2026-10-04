import { invoke } from "@tauri-apps/api/core";
import type { StudyStats, StudyStatsRange } from "@/types";

export function getStudyStats(range: StudyStatsRange): Promise<StudyStats> {
  return invoke("get_study_stats", { range });
}

/** Fire-and-forget: evaluates goal/streak progress and lets any newly-earned companion events fire. */
export function checkStudyGoals(): Promise<void> {
  return invoke("check_study_goals");
}
