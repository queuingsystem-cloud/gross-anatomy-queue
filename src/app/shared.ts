import { projectId } from "../../utils/supabase/info";

/* ──────────────────────── Constants ──────────────────────── */

export const EDGE_FUNCTION_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-6a67b1c8`;
export const TABLE_TOKEN_STORAGE_KEY = "gross-anatomy-table-token";

/* ──────────────────────── Shared types ──────────────────────── */

export interface LabSession {
  id: string;
  title: string;
  requests_status: "open" | "closed";
  cooldown_seconds: number;
}

export interface LabTable {
  id: string;
  label: string;
  zone: string | null;
  sort_order: number;
}

export interface SessionContext {
  session: LabSession | null;
  tables: LabTable[];
  assignment: LabTable | null;
  usage: { next_allowed_at: string | null } | null;
}

export interface HelpRequest {
  id: string;
  session_id: string;
  table_id: string;
  table_label: string;
  zone: string | null;
  problem: string;
  problem_category: string;
  status: string;
  created_at: string;
  instructor_arrived_at: string | null;
  completed_at: string | null;
}

/* ──────────────────────── Shared utilities ──────────────────────── */

export function tableHeaders(tableToken: string | null, includeJson = true) {
  const headers: Record<string, string> = {};
  if (includeJson) headers["Content-Type"] = "application/json";
  if (tableToken) headers["X-Table-Token"] = tableToken;
  return headers;
}

export function formatCountdown(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Sanitize user-provided text for display. Strips HTML tags and limits length.
 */
export function sanitizeDisplayText(text: string, maxLength = 300): string {
  return text.replace(/<[^>]*>/g, "").slice(0, maxLength);
}
