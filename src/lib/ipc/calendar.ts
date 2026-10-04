import { invoke } from "@tauri-apps/api/core";
import type { CalendarItem } from "@/types";

export function getCalendarRange(startDate: string, endDate: string): Promise<CalendarItem[]> {
  return invoke("get_calendar_range", { startDate, endDate });
}
