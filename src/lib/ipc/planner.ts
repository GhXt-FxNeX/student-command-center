import { invoke } from "@tauri-apps/api/core";
import type { NewScheduleBlock, PlanRequest, PlanResult, ScheduleBlock } from "@/types";

export function listScheduleBlocks(date: string): Promise<ScheduleBlock[]> {
  return invoke("list_schedule_blocks", { date });
}

export function createScheduleBlock(block: NewScheduleBlock): Promise<ScheduleBlock> {
  return invoke("create_schedule_block", { block });
}

export function updateScheduleBlock(id: number, block: NewScheduleBlock): Promise<ScheduleBlock> {
  return invoke("update_schedule_block", { id, block });
}

export function setScheduleBlockCompleted(id: number, completed: boolean): Promise<ScheduleBlock> {
  return invoke("set_schedule_block_completed", { id, completed });
}

export function deleteScheduleBlock(id: number): Promise<void> {
  return invoke("delete_schedule_block", { id });
}

export function generatePlan(req: PlanRequest): Promise<PlanResult> {
  return invoke("generate_plan", { req });
}

export function reoptimizePlan(date: string): Promise<PlanResult> {
  return invoke("reoptimize_plan", { date });
}
