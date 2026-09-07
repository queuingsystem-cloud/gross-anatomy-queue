import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BarChart3,
  Check,
  Clipboard,
  Download,
  ExternalLink,
  LayoutTemplate,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  KeyRound,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Square,
  Timer,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { projectId } from "../../utils/supabase/info";
import { supabase } from "../../utils/supabase/client";
import { ROOM_LAYOUT_PRESETS, type RoomLayoutId, sortTablesNumerically } from "./roomLayout";

const EDGE_FUNCTION_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-6a67b1c8`;

interface LabTable {
  id: string;
  label: string;
  zone: string | null;
  sort_order: number;
  request_count: number;
  waiting_request_id: string | null;
  waiting_since: string | null;
  representative_claimed: boolean;
  cooldown_reset_at: string | null;
}

interface LabSession {
  id: string;
  title: string;
  status: "draft" | "open" | "closed";
  cooldown_seconds: number;
  requests_open_at: string | null;
  requests_close_at: string | null;
  created_at: string;
  archived_at: string | null;
  tables: LabTable[];
}

interface SessionReport {
  summary: {
    total_requests: number;
    arrived: number;
    waiting: number;
    student_cancelled: number;
    admin_cancelled: number;
    average_wait_seconds: number | null;
    median_wait_seconds: number | null;
    longest_wait_seconds: number | null;
    peak_hour: string | null;
    peak_hour_requests: number;
    tables_never_requested: number;
  };
  categories: Array<{ category: string; count: number }>;
  tables: Array<{ id: string; label: string; zone: string | null; total_requests: number; arrived: number; student_cancelled: number; admin_cancelled: number; average_wait_seconds: number | null }>;
  questions: Array<{ id: string; table_label: string; problem: string; category: string; status: string; created_at: string; instructor_arrived_at: string | null; wait_seconds: number | null }>;
}

interface GeneratedPin {
  table_id?: string;
  label: string;
  zone?: string | null;
  pin: string;
}

interface AdminAccessEntry {
  email: string;
  role: "admin" | "instructor";
  active: boolean;
  created_at: string;
}

interface AdminConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
  dangerous?: boolean;
  verificationText?: string;
  action: () => Promise<unknown>;
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

function safeCsvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function requestState(session: LabSession, now: number) {
  if (session.status !== "open") return "unavailable" as const;
  if (session.requests_open_at && new Date(session.requests_open_at).getTime() > now) return "scheduled" as const;
  if (session.requests_close_at && new Date(session.requests_close_at).getTime() <= now) return "paused" as const;
  return "open" as const;
}

function countdown(value: string, now: number) {
  const totalSeconds = Math.max(0, Math.ceil((new Date(value).getTime() - now) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  identify_structure: "Identify a structure",
  dissection_technique: "Dissection technique",
  anatomical_relationship: "Anatomical relationships",
  clarify_instructions: "Clarify instructions",
  specimen_issue: "Specimen problem",
  other: "Other",
};

function durationLabel(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export default function AdminApp() {
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [adminLoading, setAdminLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [sessions, setSessions] = useState<LabSession[]>([]);
  const [title, setTitle] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState(10);
  const [layoutPreset, setLayoutPreset] = useState<RoomLayoutId>("2569");
  const [submitting, setSubmitting] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedPins, setGeneratedPins] = useState<GeneratedPin[]>([]);
  const [pinsExpanded, setPinsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scheduleMinutes, setScheduleMinutes] = useState(30);
  const [now, setNow] = useState(() => Date.now());
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [confirmation, setConfirmation] = useState<AdminConfirmation | null>(null);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [reports, setReports] = useState<Record<string, SessionReport>>({});
  const [reportLoadingId, setReportLoadingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [adminAccess, setAdminAccess] = useState<AdminAccessEntry[]>([]);
  const [accessEmail, setAccessEmail] = useState("");
  const [accessRole, setAccessRole] = useState<"admin" | "instructor">("instructor");
  const [cooldownEdits, setCooldownEdits] = useState<Record<string, number>>({});
  const [pinEdits, setPinEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAuthSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setAuthSession((current) => (
        current?.access_token === next?.access_token && current?.user.id === next?.user.id ? current : next
      ));
      setAuthLoading(false);
      if (!next) {
        setIsAdmin(null);
        setSessions([]);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadAdmin = useCallback(async (showLoading = true) => {
    if (!authSession) return;
    if (showLoading) {
      setAdminLoading(true);
      setError(null);
    }
    try {
      const statusResponse = await fetch(`${EDGE_FUNCTION_BASE}/admin/status`, {
        headers: authHeaders(authSession.access_token),
      });
      if (statusResponse.status === 403) {
        setIsAdmin(false);
        return;
      }
      if (!statusResponse.ok) throw new Error();
      const status = await statusResponse.json();
      setIsAdmin(true);
      setAdminEmail(status.email ?? "");

      const [sessionsResponse, accessResponse] = await Promise.all([
        fetch(`${EDGE_FUNCTION_BASE}/admin/sessions`, { headers: authHeaders(authSession.access_token) }),
        fetch(`${EDGE_FUNCTION_BASE}/admin/access`, { headers: authHeaders(authSession.access_token) }),
      ]);
      if (!sessionsResponse.ok || !accessResponse.ok) throw new Error();
      const [result, accessResult] = await Promise.all([sessionsResponse.json(), accessResponse.json()]);
      setSessions(Array.isArray(result) ? result : []);
      setAdminAccess(Array.isArray(accessResult) ? accessResult : []);
    } catch {
      setError("Could not load the administrator page. Please try again.");
    } finally {
      if (showLoading) setAdminLoading(false);
    }
  }, [authSession]);

  useEffect(() => {
    if (authSession) loadAdmin(true);
  }, [authSession, loadAdmin]);

  useEffect(() => {
    if (!authSession || isAdmin === false) return;

    const channel = supabase
      .channel("gross-queue-admin-events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "app_events" },
        (payload) => {
          const event = payload.new as { event_type?: string };
          if (event.event_type === "queue" || event.event_type === "session") loadAdmin(false);
        },
      )
      .subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));

    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") loadAdmin(false);
    }, 15000);

    return () => {
      window.clearInterval(fallback);
      setRealtimeConnected(false);
      supabase.removeChannel(channel);
    };
  }, [authSession, isAdmin, loadAdmin]);

  const selectedLayout = ROOM_LAYOUT_PRESETS[layoutPreset];
  const tables = useMemo(() => [...selectedLayout.tables], [selectedLayout]);

  const login = async () => {
    setError(null);
    const { error: loginError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/admin`, queryParams: { prompt: "select_account" } },
    });
    if (loginError) setError("Could not start Google sign-in.");
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const createSession = async () => {
    if (!authSession || submitting) return;
    if (title.trim().length < 3 || tables.length < 1 || tables.some((table) => !table.label)) {
      setError("Enter a session name and at least one table.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setGeneratedPins([]);
    setPinsExpanded(false);
    try {
      const response = await fetch(`${EDGE_FUNCTION_BASE}/admin/sessions`, {
        method: "POST",
        headers: authHeaders(authSession.access_token),
        body: JSON.stringify({
          title: title.trim(),
          cooldown_seconds: Math.round(cooldownMinutes * 60),
          layout_id: layoutPreset,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Could not create the session.");
        return;
      }
      setGeneratedPins(result.pins ?? []);
      setTitle("");
      await loadAdmin(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (sessionId: string, action: "open" | "close") => {
    if (!authSession || changingId) return;
    setChangingId(sessionId);
    setError(null);
    try {
      const response = await fetch(`${EDGE_FUNCTION_BASE}/admin/sessions/${sessionId}/${action}`, {
        method: "PATCH",
        headers: authHeaders(authSession.access_token),
      });
      if (!response.ok) throw new Error();
      await loadAdmin(false);
    } catch {
      setError(`Could not ${action} the session.`);
    } finally {
      setChangingId(null);
    }
  };

  const changeRequestState = async (sessionId: string, action: "schedule" | "open" | "pause") => {
    if (!authSession || changingId) return;
    setChangingId(sessionId);
    setError(null);
    try {
      const response = await fetch(`${EDGE_FUNCTION_BASE}/admin/sessions/${sessionId}/requests/${action}`, {
        method: "PATCH",
        headers: authHeaders(authSession.access_token),
        body: action === "schedule" ? JSON.stringify({ delay_minutes: scheduleMinutes }) : undefined,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Could not update request access.");
        return;
      }
      await loadAdmin(false);
    } catch {
      setError("Could not update request access.");
    } finally {
      setChangingId(null);
    }
  };

  const runAdminAction = async (
    actionId: string,
    path: string,
    method: "PATCH" | "POST" | "DELETE",
    body?: Record<string, unknown>,
  ) => {
    if (!authSession || changingId) return null;
    setChangingId(actionId);
    setError(null);
    try {
      const response = await fetch(`${EDGE_FUNCTION_BASE}${path}`, {
        method,
        headers: authHeaders(authSession.access_token),
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Could not complete the administrator action.");
        return null;
      }
      await loadAdmin(false);
      return result;
    } catch {
      setError("Network error. Please try again.");
      return null;
    } finally {
      setChangingId(null);
    }
  };

  const cancelForTable = async (table: LabTable) => {
    if (!table.waiting_request_id) return;
    setConfirmationInput("");
    setConfirmation({
      title: `Cancel ${table.label}'s request?`,
      message: "The request will leave the queue and its waiting timer will stop. The table's cooldown will also reset.",
      confirmLabel: "Cancel and reset cooldown",
      dangerous: true,
      action: async () => { await runAdminAction(`cancel-${table.id}`, `/admin/requests/${table.waiting_request_id}/cancel`, "PATCH"); },
    });
  };

  const resetTableCooldown = async (table: LabTable) => {
    setConfirmationInput("");
    setConfirmation({
      title: `Reset ${table.label}'s cooldown?`,
      message: "This table will be able to submit another request immediately.",
      confirmLabel: "Reset cooldown",
      action: async () => { await runAdminAction(`cooldown-${table.id}`, `/admin/tables/${table.id}/cooldown/reset`, "PATCH"); },
    });
  };

  const releaseRepresentative = async (table: LabTable) => {
    if (table.waiting_request_id) {
      setError(`Cancel ${table.label}'s waiting request before releasing its representative.`);
      return;
    }
    setConfirmationInput("");
    setConfirmation({
      title: `Release ${table.label}'s representative?`,
      message: "The current representative will lose access to this table. A student will need the table PIN to claim it again.",
      confirmLabel: "Release representative",
      dangerous: true,
      action: async () => { await runAdminAction(`release-${table.id}`, `/admin/tables/${table.id}/assignment`, "DELETE"); },
    });
  };

  const togglePermanentPins = async () => {
    if (pinsExpanded) {
      setPinsExpanded(false);
      return;
    }
    if (generatedPins.length > 0) {
      setPinsExpanded(true);
      return;
    }
    if (!authSession || changingId) return;
    setChangingId("load-pins");
    setError(null);
    try {
      const response = await fetch(`${EDGE_FUNCTION_BASE}/admin/table-pins?layout_id=${encodeURIComponent(layoutPreset)}`, {
        headers: authHeaders(authSession.access_token),
      });
      const result = await response.json().catch(() => ([]));
      if (!response.ok) {
        setError(result.error ?? "Could not load permanent table PINs.");
        return;
      }
      setGeneratedPins(Array.isArray(result) ? result : []);
      setPinEdits({});
      setPinsExpanded(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setChangingId(null);
    }
  };

  const savePermanentPin = async (item: GeneratedPin) => {
    const pin = (pinEdits[item.label] ?? item.pin).trim();
    if (!/^\d{6}$/.test(pin)) {
      setError("A table PIN must contain exactly 6 digits.");
      return;
    }
    const result = await runAdminAction(
      `pin-${item.label}`,
      `/admin/table-pins/${encodeURIComponent(item.label)}`,
      "PATCH",
      { pin },
    );
    if (!result) return;
    setGeneratedPins((current) => current.map((entry) => entry.label === item.label ? { ...entry, pin } : entry));
    setPinEdits((current) => {
      const next = { ...current };
      delete next[item.label];
      return next;
    });
  };

  const saveSessionCooldown = async (session: LabSession) => {
    const minutes = cooldownEdits[session.id] ?? Math.round(session.cooldown_seconds / 60);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 360) {
      setError("Cooldown must be between 0 and 360 minutes.");
      return;
    }
    const result = await runAdminAction(
      `session-cooldown-${session.id}`,
      `/admin/sessions/${session.id}/cooldown`,
      "PATCH",
      { cooldown_seconds: Math.round(minutes * 60) },
    );
    if (!result) return;
    setCooldownEdits((current) => {
      const next = { ...current };
      delete next[session.id];
      return next;
    });
  };

  const grantAdminAccess = async () => {
    if (!authSession || changingId || !accessEmail.trim()) return;
    const result = await runAdminAction("grant-access", "/admin/access", "POST", {
      email: accessEmail.trim(),
      role: accessRole,
    });
    if (result) setAccessEmail("");
  };

  const removeAdminAccess = (entry: AdminAccessEntry) => {
    setConfirmationInput("");
    setConfirmation({
      title: `Remove access for ${entry.email}?`,
      message: "This Google account will no longer be able to open the Admin or classroom display pages.",
      confirmLabel: "Remove access",
      dangerous: true,
      action: async () => { await runAdminAction(`remove-access-${entry.email}`, "/admin/access", "DELETE", { email: entry.email }); },
    });
  };

  const clearQueue = async (session: LabSession) => {
    setConfirmationInput("");
    setConfirmation({
      title: `Reset the queue for ${session.title}?`,
      message: "New requests will be paused. Every waiting request will be cancelled, its timer will stop, and every cooldown will be reset.",
      confirmLabel: "Pause and reset queue",
      dangerous: true,
      verificationText: "RESET",
      action: async () => {
        const paused = await runAdminAction(`pause-clear-${session.id}`, `/admin/sessions/${session.id}/requests/pause`, "PATCH");
        if (!paused) return;
        await runAdminAction(`clear-${session.id}`, `/admin/sessions/${session.id}/queue/clear`, "PATCH");
      },
    });
  };

  const resetAllCooldowns = async (session: LabSession) => {
    setConfirmationInput("");
    setConfirmation({
      title: "Reset every cooldown?",
      message: `Every table in ${session.title} will be able to request again immediately.`,
      confirmLabel: "Reset all cooldowns",
      action: async () => { await runAdminAction(`cooldowns-${session.id}`, `/admin/sessions/${session.id}/cooldowns/reset`, "PATCH"); },
    });
  };

  const loadReport = async (sessionId: string) => {
    if (!authSession || reportLoadingId) return;
    if (reports[sessionId]) {
      setReports((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      return;
    }
    setReportLoadingId(sessionId);
    setError(null);
    try {
      const response = await fetch(`${EDGE_FUNCTION_BASE}/admin/sessions/${sessionId}/report`, {
        headers: authHeaders(authSession.access_token),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Could not load the session report.");
        return;
      }
      setReports((current) => ({ ...current, [sessionId]: result }));
    } catch {
      setError("Network error while loading the session report.");
    } finally {
      setReportLoadingId(null);
    }
  };

  const endSession = (session: LabSession) => {
    setConfirmationInput("");
    setConfirmation({
      title: `End ${session.title}?`,
      message: "The session will close and its report will become available. Any requests still waiting will be cancelled so no old queue remains stuck.",
      confirmLabel: "End session",
      dangerous: true,
      action: async () => { await changeStatus(session.id, "close"); },
    });
  };

  const archiveSession = (session: LabSession) => {
    setConfirmationInput("");
    setConfirmation({
      title: `Archive ${session.title}?`,
      message: "The session and its full report will be kept in Supabase, but it will move out of the main session list. A draft will be closed automatically before it is archived.",
      confirmLabel: "Archive session",
      action: () => runAdminAction(`archive-${session.id}`, `/admin/sessions/${session.id}/archive`, "PATCH"),
    });
  };

  const restoreSession = (session: LabSession) => {
    setConfirmationInput("");
    setConfirmation({
      title: `Restore ${session.title}?`,
      message: "The session will return to the main list. Its history and report are unchanged.",
      confirmLabel: "Restore session",
      action: async () => { await runAdminAction(`restore-${session.id}`, `/admin/sessions/${session.id}/restore`, "PATCH"); },
    });
  };

  const deleteSession = (session: LabSession) => {
    setConfirmationInput("");
    setConfirmation({
      title: `Permanently delete ${session.title}?`,
      message: "This permanently removes the session, tables, assignments, requests, and report data from Supabase. It cannot be undone.",
      confirmLabel: "Delete permanently",
      dangerous: true,
      verificationText: session.title,
      action: async () => {
        const result = await runAdminAction(`delete-${session.id}`, `/admin/sessions/${session.id}`, "DELETE");
        if (result) setReports((current) => {
          const next = { ...current };
          delete next[session.id];
          return next;
        });
      },
    });
  };

  const confirmAdminAction = async () => {
    if (!confirmation || confirmationBusy) return;
    if (confirmation.verificationText && confirmationInput !== confirmation.verificationText) return;
    setConfirmationBusy(true);
    try {
      const result = await confirmation.action();
      if (result === null) return;
      setConfirmation(null);
      setConfirmationInput("");
    } finally {
      setConfirmationBusy(false);
    }
  };

  const pinText = sortTablesNumerically(generatedPins).map((item) => `${item.label}${item.zone ? ` (${item.zone})` : ""}: ${item.pin}`).join("\n");

  const copyPins = async () => {
    await navigator.clipboard.writeText(pinText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const downloadPins = () => {
    const rows = ["Table,Zone,PIN", ...sortTablesNumerically(generatedPins).map((item) => [safeCsvCell(item.label), safeCsvCell(item.zone ?? ""), safeCsvCell(item.pin)].join(","))];
    const blob = new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `room-layout-${layoutPreset}-table-pins.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const visibleSessions = sessions.filter((session) => showArchived || !session.archived_at);
  const archivedCount = sessions.filter((session) => session.archived_at).length;

  if (authLoading || adminLoading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><LoaderCircle className="w-9 h-9 animate-spin text-[#67ad66]" /></div>;
  }

  if (!authSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center">
          <LockKeyhole className="w-12 h-12 text-[#67ad66] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Instructor administration</h1>
          <p className="text-sm text-gray-500 mt-2 mb-6">Only accounts added to the administrator list can enter.</p>
          {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
          <button onClick={login} className="w-full bg-[#1e3a5f] text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2"><LogIn className="w-5 h-5" />Sign in with Google</button>
          <a href="/student" className="inline-block mt-5 text-sm text-gray-400 underline">Student page</a>
        </div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md bg-white rounded-3xl shadow-xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-[#1e3a5f]">Administrator access has not been granted</h1>
          <p className="text-sm text-gray-500 mt-2">Ask the project owner to add this account to the administrator list.</p>
          <button onClick={logout} className="mt-5 text-sm underline text-gray-500">Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-7">
      <header className="max-w-6xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-100 px-5 py-4 flex items-center gap-3">
        <a href="/" title="Back to home" className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-gray-500"><ArrowLeft className="w-4 h-4" /></a>
        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center"><Users className="w-5 h-5 text-[#67ad66]" /></div>
        <div><h1 className="font-bold text-[#1e3a5f]">Gross Anatomy Queue Admin</h1><p className="text-xs text-gray-400 flex items-center gap-1.5"><span className={`inline-block w-2 h-2 rounded-full ${realtimeConnected ? "bg-green-500" : "bg-amber-400"}`} />{realtimeConnected ? "Live updates" : "Connecting"} · {adminEmail}</p></div>
        <a href="/display" target="_blank" rel="noreferrer" className="ml-auto text-sm bg-[#1e3a5f] text-white px-3 py-2 rounded-lg flex items-center gap-1.5"><ExternalLink className="w-4 h-4" />Classroom display</a>
        <a href="/student" className="text-sm text-gray-500 underline">Student page</a>
        <button onClick={logout} title="Sign out" className="text-gray-400"><LogOut className="w-5 h-5" /></button>
      </header>

      {error && <div className="max-w-6xl mx-auto mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}

      <main className="max-w-6xl mx-auto mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center gap-2 mb-5"><Plus className="w-5 h-5 text-[#67ad66]" /><h2 className="font-bold text-[#1e3a5f]">Create a lab session</h2></div>
          <label className="text-sm text-gray-600">Session name</label>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Upper limb — 5 August" className="w-full mt-1 mb-4 rounded-xl border border-gray-200 px-3 py-3 outline-none focus:ring-2 focus:ring-green-200" />
          <label className="text-sm text-gray-600">Cooldown (minutes)</label>
          <input type="number" min={0} max={360} value={cooldownMinutes} onChange={(event) => setCooldownMinutes(Number(event.target.value))} className="w-full mt-1 rounded-xl border border-gray-200 px-3 py-3 outline-none focus:ring-2 focus:ring-green-200" />
          <label className="block text-sm text-gray-600 mt-4">Room layout</label>
          <div className="relative mt-1">
            <LayoutTemplate className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
            <select
              value={layoutPreset}
              onChange={(event) => {
                setLayoutPreset(event.target.value as RoomLayoutId);
                setGeneratedPins([]);
                setPinEdits({});
                setPinsExpanded(false);
              }}
              className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-3 outline-none focus:ring-2 focus:ring-green-200"
            >
              {Object.values(ROOM_LAYOUT_PRESETS).map((layout) => (
                <option key={layout.id} value={layout.id}>{layout.name} — {layout.description}</option>
              ))}
            </select>
          </div>
          <p className="mt-2 text-xs text-gray-400">The table positions, zones, and permanent PIN list are fixed by this room layout.</p>
          {error && <p className="mt-3 text-sm text-red-500 flex items-start gap-1"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}</p>}
          <button onClick={createSession} disabled={submitting} className="w-full mt-5 bg-[#1e3a5f] text-white font-semibold py-3 rounded-xl disabled:opacity-50">{submitting ? "Creating…" : "Create draft"}</button>
        </section>

        <div className="space-y-6">
          <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-violet-600" /><div><h2 className="font-bold text-[#1e3a5f]">Permanent table PINs</h2><p className="text-xs text-gray-400 mt-0.5">Each PIN is reused in every lab session until an administrator changes it.</p></div></div>
            <button onClick={togglePermanentPins} disabled={Boolean(changingId)} className="mt-4 w-full rounded-xl border border-violet-200 bg-violet-50 py-2.5 text-sm font-semibold text-violet-700 disabled:opacity-50">{pinsExpanded ? "Hide PIN list" : "View or download PIN list"}</button>
            {pinsExpanded && generatedPins.length > 0 && <div className="mt-4">
              <div className="max-h-64 overflow-y-auto rounded-xl border border-violet-100 bg-white divide-y divide-gray-100">
                {sortTablesNumerically(generatedPins).map((item) => {
                  const editedPin = pinEdits[item.label] ?? item.pin;
                  const changed = editedPin !== item.pin;
                  return <div key={item.table_id ?? item.label} className="px-3 py-2 flex items-center gap-2"><span className="min-w-16 font-medium text-gray-700">Table {item.label}</span><input aria-label={`PIN for table ${item.label}`} inputMode="numeric" maxLength={6} value={editedPin} onChange={(event) => setPinEdits((current) => ({ ...current, [item.label]: event.target.value.replace(/\D/g, "").slice(0, 6) }))} className="ml-auto w-28 rounded-lg border border-violet-100 bg-violet-50/50 px-2 py-1.5 text-center font-mono font-bold tracking-widest text-[#1e3a5f] outline-none focus:ring-2 focus:ring-violet-200" /><button onClick={() => savePermanentPin(item)} disabled={Boolean(changingId) || !changed || !/^\d{6}$/.test(editedPin)} className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-30">Save</button></div>;
                })}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3"><button onClick={copyPins} className="rounded-xl border border-violet-200 bg-white py-2.5 text-violet-700 flex items-center justify-center gap-2">{copied ? <Check className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />}{copied ? "Copied" : "Copy"}</button><button onClick={downloadPins} className="rounded-xl border border-violet-200 bg-white py-2.5 text-violet-700 flex items-center justify-center gap-2"><Download className="w-4 h-4" />Download CSV</button></div>
            </div>}
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center gap-2"><Users className="w-5 h-5 text-[#67ad66]" /><div><h2 className="font-bold text-[#1e3a5f]">Admin access</h2><p className="text-xs text-gray-400 mt-0.5">Any Google email can be granted access; no Chula domain is required.</p></div></div>
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
              <input type="email" value={accessEmail} onChange={(event) => setAccessEmail(event.target.value)} placeholder="instructor@example.com" className="min-w-0 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-green-200" />
              <select value={accessRole} onChange={(event) => setAccessRole(event.target.value as "admin" | "instructor")} className="rounded-xl border border-gray-200 bg-white px-2 text-sm"><option value="instructor">Instructor</option><option value="admin">Admin</option></select>
            </div>
            <button onClick={grantAdminAccess} disabled={Boolean(changingId) || !accessEmail.trim()} className="mt-2 w-full rounded-xl bg-[#1e3a5f] py-2.5 text-sm font-semibold text-white disabled:opacity-50">Grant access</button>
            <div className="mt-4 max-h-60 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100">
              {adminAccess.length === 0 ? <p className="p-3 text-xs text-gray-400">No email-based access has been added yet. Existing Supabase user-ID admins still work.</p> : adminAccess.map((entry) => <div key={entry.email} className="flex items-center gap-2 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-700">{entry.email}</p><p className="text-[10px] uppercase text-gray-400">{entry.role}</p></div><button onClick={() => removeAdminAccess(entry)} disabled={Boolean(changingId) || entry.email === adminEmail} className="ml-auto rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600 disabled:opacity-30">Remove</button></div>)}
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="mb-4 flex items-center gap-2"><h2 className="font-bold text-[#1e3a5f]">Lab sessions</h2>{archivedCount > 0 && <button onClick={() => setShowArchived((value) => !value)} className="ml-auto rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">{showArchived ? "Hide archived" : `Show archived (${archivedCount})`}</button>}</div>
            {sessions.length === 0 ? <p className="text-sm text-gray-400">No sessions have been created yet.</p> : visibleSessions.length === 0 ? <p className="text-sm text-gray-400">All sessions are archived.</p> : <div className="space-y-3">{visibleSessions.map((session) => {
              const requests = requestState(session, now);
              const waitingCount = session.tables.filter((table) => table.waiting_request_id).length;
              const report = reports[session.id];
              return <div key={session.id} className={`rounded-xl border p-4 ${session.archived_at ? "border-slate-200 bg-slate-50/60" : "border-gray-100"}`}>
                <div className="flex items-start gap-3"><div className="min-w-0"><p className="font-semibold text-gray-800 truncate">{session.title}</p><p className="text-xs text-gray-400 mt-1">{session.tables.length} tables · cooldown {Math.round(session.cooldown_seconds / 60)} min · {waitingCount} waiting</p></div><span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-semibold ${session.archived_at ? "bg-slate-200 text-slate-600" : session.status === "open" ? "bg-green-100 text-green-700" : session.status === "closed" ? "bg-gray-100 text-gray-500" : "bg-amber-100 text-amber-700"}`}>{session.archived_at ? "archived" : session.status}</span></div>
                {session.status === "open" && <>
                  <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 p-3">
                    <div className="flex items-center gap-2"><Timer className="w-4 h-4 text-[#67ad66]" /><p className="text-sm font-semibold">Help requests</p><span className={`ml-auto text-xs font-bold rounded-full px-2 py-1 ${requests === "open" ? "bg-green-100 text-green-700" : requests === "scheduled" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{requests === "open" ? "OPEN" : requests === "scheduled" ? `OPENS IN ${countdown(session.requests_open_at!, now)}` : "PAUSED"}</span></div>
                    <div className="mt-3 flex flex-wrap gap-2"><div className="flex items-center border border-slate-200 bg-white rounded-lg overflow-hidden"><input type="number" min={1} max={360} value={scheduleMinutes} onChange={(event) => setScheduleMinutes(Number(event.target.value))} className="w-16 px-2 py-2 text-sm outline-none" /><span className="text-xs text-gray-400 pr-2">min</span></div><button onClick={() => changeRequestState(session.id, "schedule")} disabled={Boolean(changingId)} className="text-xs bg-blue-50 text-blue-700 px-3 py-2 rounded-lg disabled:opacity-50"><Timer className="w-3.5 h-3.5 inline mr-1" />Start countdown</button><button onClick={() => changeRequestState(session.id, requests === "open" ? "pause" : "open")} disabled={Boolean(changingId)} className={`text-xs px-3 py-2 rounded-lg disabled:opacity-50 ${requests === "open" ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>{requests === "open" ? <Pause className="w-3.5 h-3.5 inline mr-1" /> : <Play className="w-3.5 h-3.5 inline mr-1" />}{requests === "open" ? "Pause requests" : "Open now"}</button></div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3"><label className="text-xs font-semibold text-slate-600">Cooldown</label><div className="flex items-center border border-slate-200 bg-white rounded-lg overflow-hidden"><input type="number" min={0} max={360} value={cooldownEdits[session.id] ?? Math.round(session.cooldown_seconds / 60)} onChange={(event) => setCooldownEdits((current) => ({ ...current, [session.id]: Number(event.target.value) }))} className="w-16 px-2 py-2 text-sm outline-none" /><span className="text-xs text-gray-400 pr-2">min</span></div><button onClick={() => saveSessionCooldown(session)} disabled={Boolean(changingId) || (cooldownEdits[session.id] ?? Math.round(session.cooldown_seconds / 60)) === Math.round(session.cooldown_seconds / 60)} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-30">Save cooldown</button></div>
                  </div>

                  <details className="mt-3 rounded-xl border border-slate-200 bg-white">
                    <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-[#1e3a5f]">Manage individual tables</summary>
                    <div className="max-h-96 overflow-y-auto border-t border-slate-100 divide-y divide-slate-100">
                      {sortTablesNumerically(session.tables).map((table) => <div key={table.id} className="p-3">
                        <div className="flex items-center gap-2"><div><p className="text-sm font-semibold text-gray-700">{table.label}{table.zone ? <span className="font-normal text-gray-400"> · {table.zone}</span> : null}</p><p className="text-[11px] text-gray-400">{table.request_count} request{table.request_count === 1 ? "" : "s"} · {table.representative_claimed ? "representative claimed" : "unclaimed"}{table.waiting_since ? ` · waiting ${durationLabel(Math.max(0, Math.floor((now - new Date(table.waiting_since).getTime()) / 1000)))}` : ""}</p></div>{table.waiting_request_id && <span className="ml-auto rounded-full bg-pink-100 px-2 py-1 text-[10px] font-bold text-pink-700">WAITING</span>}</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button onClick={() => cancelForTable(table)} disabled={!table.waiting_request_id || Boolean(changingId)} className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600 disabled:opacity-40"><Trash2 className="w-3 h-3 inline mr-1" />Cancel request</button>
                          <button onClick={() => resetTableCooldown(table)} disabled={Boolean(changingId)} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-700 disabled:opacity-40"><RotateCcw className="w-3 h-3 inline mr-1" />Reset cooldown</button>
                          <button onClick={() => releaseRepresentative(table)} disabled={!table.representative_claimed || Boolean(changingId)} className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 disabled:opacity-40"><UserMinus className="w-3 h-3 inline mr-1" />Release representative</button>
                        </div>
                      </div>)}
                    </div>
                  </details>

                  <div className="mt-3 rounded-xl border border-red-100 bg-red-50/50 p-3"><p className="text-xs font-semibold text-red-700">Emergency controls</p><p className="mt-1 text-[11px] text-red-500">Queue reset pauses requests first, stops all active waiting timers, and clears cooldowns.</p><div className="mt-2 flex flex-wrap gap-2"><button onClick={() => resetAllCooldowns(session)} disabled={Boolean(changingId)} className="rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs text-amber-700 disabled:opacity-50"><RefreshCcw className="w-3.5 h-3.5 inline mr-1" />Reset all cooldowns</button><button onClick={() => clearQueue(session)} disabled={Boolean(changingId)} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Trash2 className="w-3.5 h-3.5 inline mr-1" />Pause and reset queue</button></div></div>
                </>}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {session.status === "open" ? <button onClick={() => endSession(session)} disabled={Boolean(changingId)} className="text-sm bg-red-50 text-red-600 px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-50"><Square className="w-3.5 h-3.5" />End session</button> : <>
                    <button onClick={() => loadReport(session.id)} disabled={reportLoadingId === session.id} className="text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-50"><BarChart3 className="w-3.5 h-3.5" />{reportLoadingId === session.id ? "Loading…" : report ? "Hide report" : "View report"}</button>
                    {!session.archived_at && <button onClick={() => archiveSession(session)} disabled={Boolean(changingId)} className="text-sm bg-slate-100 text-slate-600 px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-50"><Archive className="w-3.5 h-3.5" />Archive</button>}
                    {!session.archived_at && <button onClick={() => changeStatus(session.id, "open")} disabled={Boolean(changingId)} className="text-sm bg-green-50 text-green-700 px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-50"><Play className="w-3.5 h-3.5" />Open session</button>}
                    {session.archived_at && <button onClick={() => restoreSession(session)} disabled={Boolean(changingId)} className="text-sm bg-green-50 text-green-700 px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-50"><ArchiveRestore className="w-3.5 h-3.5" />Restore</button>}
                    {session.archived_at && <button onClick={() => deleteSession(session)} disabled={Boolean(changingId)} className="text-sm bg-red-50 text-red-600 px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" />Delete permanently</button>}
                  </>}
                </div>
                {report && <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/30 p-3">
                  <div className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-600" /><p className="text-sm font-bold text-[#1e3a5f]">Session report</p></div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center"><div className="rounded-lg bg-white p-2"><p className="text-xl font-bold text-[#1e3a5f]">{report.summary.total_requests}</p><p className="text-[10px] text-gray-400">total requests</p></div><div className="rounded-lg bg-white p-2"><p className="text-xl font-bold text-green-600">{report.summary.arrived}</p><p className="text-[10px] text-gray-400">instructor arrived</p></div><div className="rounded-lg bg-white p-2"><p className="text-lg font-bold text-[#1e3a5f]">{durationLabel(report.summary.median_wait_seconds)}</p><p className="text-[10px] text-gray-400">median wait</p></div><div className="rounded-lg bg-white p-2"><p className="text-lg font-bold text-[#1e3a5f]">{durationLabel(report.summary.longest_wait_seconds)}</p><p className="text-[10px] text-gray-400">longest wait</p></div></div>
                  <div className="mt-3 text-xs text-gray-500 space-y-1"><p>Average wait: <strong>{durationLabel(report.summary.average_wait_seconds)}</strong></p><p>Student cancellations: <strong>{report.summary.student_cancelled}</strong> · Admin cancellations: <strong>{report.summary.admin_cancelled}</strong></p><p>Peak request period: <strong>{report.summary.peak_hour ?? "—"}</strong>{report.summary.peak_hour ? ` (${report.summary.peak_hour_requests})` : ""}</p><p>Tables with no requests: <strong>{report.summary.tables_never_requested}</strong></p></div>
                  <div className="mt-4"><p className="text-xs font-bold text-gray-600">Question categories</p>{report.categories.length ? <div className="mt-2 space-y-1">{report.categories.map((category) => <div key={category.category} className="flex items-center rounded-lg bg-white px-2.5 py-2 text-xs"><span>{CATEGORY_LABELS[category.category] ?? category.category}</span><strong className="ml-auto">{category.count}</strong></div>)}</div> : <p className="mt-1 text-xs text-gray-400">No categorized requests yet.</p>}</div>
                  <details className="mt-3 rounded-lg bg-white"><summary className="cursor-pointer px-3 py-2 text-xs font-bold text-gray-600">Requests by table</summary><div className="border-t border-gray-100 divide-y divide-gray-100">{sortTablesNumerically(report.tables).map((table) => <div key={table.id} className="px-3 py-2 text-xs"><div className="flex"><strong>{table.label}</strong><span className="ml-auto">{table.total_requests} requests</span></div><p className="mt-1 text-gray-400">Arrived {table.arrived} · student cancelled {table.student_cancelled} · admin cancelled {table.admin_cancelled} · avg wait {durationLabel(table.average_wait_seconds)}</p></div>)}</div></details>
                  <details className="mt-2 rounded-lg bg-white"><summary className="cursor-pointer px-3 py-2 text-xs font-bold text-gray-600">Question log ({report.questions.length})</summary><div className="max-h-64 overflow-y-auto border-t border-gray-100 divide-y divide-gray-100">{report.questions.map((question) => <div key={question.id} className="px-3 py-2 text-xs"><div className="flex gap-2"><strong>{question.table_label}</strong><span className="text-gray-400">{CATEGORY_LABELS[question.category] ?? "Other"}</span><span className="ml-auto text-gray-400">{question.status}{question.wait_seconds !== null ? ` · waited ${durationLabel(question.wait_seconds)}` : ""}</span></div><p className="mt-1 text-gray-600">{question.problem}</p></div>)}</div></details>
                </div>}
              </div>;
            })}</div>}
          </section>
        </div>
      </main>

      {confirmation && <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h2 id="admin-confirm-title" className="text-lg font-bold text-[#1e3a5f]">{confirmation.title}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-500">{confirmation.message}</p>
          {confirmation.verificationText && <div className="mt-4"><label className="text-xs font-semibold text-gray-600">Type <span className="font-mono text-red-600">{confirmation.verificationText}</span> to continue</label><input autoFocus value={confirmationInput} onChange={(event) => setConfirmationInput(event.target.value)} className="mt-1 w-full rounded-xl border border-red-200 px-3 py-2.5 font-mono outline-none focus:ring-2 focus:ring-red-200" /></div>}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button onClick={() => { setConfirmation(null); setConfirmationInput(""); }} disabled={confirmationBusy} className="rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50">Go back</button>
            <button onClick={confirmAdminAction} disabled={confirmationBusy || Boolean(confirmation.verificationText && confirmationInput !== confirmation.verificationText)} className={`rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-40 ${confirmation.dangerous ? "bg-red-600" : "bg-[#1e3a5f]"}`}>{confirmationBusy ? "Working…" : confirmation.confirmLabel}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
