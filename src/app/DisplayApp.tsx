import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AlertCircle, ArrowLeft, Clock, ExternalLink, LoaderCircle, Maximize, Users } from "lucide-react";
import { projectId } from "../../utils/supabase/info";
import { supabase } from "../../utils/supabase/client";
import { groupByZone, zoneStyle } from "./roomLayout";

const EDGE_FUNCTION_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-6a67b1c8`;

interface DisplaySession {
  id: string;
  title: string;
}

interface DisplayRequest {
  id: string;
  table_id: string;
  table_label: string;
  zone: string | null;
  problem: string;
  request_count: number;
}

interface DisplayTable {
  id: string;
  label: string;
  zone: string | null;
  sort_order: number;
}

interface DisplayData {
  session: DisplaySession | null;
  tables: DisplayTable[];
  queue: DisplayRequest[];
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

export default function DisplayApp() {
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [data, setData] = useState<DisplayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!active) return;
      setAuthSession(sessionData.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setAuthSession((current) => (
        current?.access_token === next?.access_token && current?.user.id === next?.user.id ? current : next
      ));
      setAuthLoading(false);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadDisplay = useCallback(async (showLoading = false) => {
    if (!authSession) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${EDGE_FUNCTION_BASE}/admin/display`, {
        headers: authHeaders(authSession.access_token),
      });
      if (response.status === 403) {
        setForbidden(true);
        return;
      }
      if (!response.ok) throw new Error();
      setForbidden(false);
      setData(await response.json());
    } catch {
      setError("Could not update the classroom queue.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [authSession]);

  useEffect(() => {
    if (!authSession) return;
    loadDisplay(true);

    // Poll every 30s as a fallback in case realtime drops
    const safetyTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadDisplay(false);
    }, 30000);

    // Refresh immediately when the tab/window regains focus
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") loadDisplay(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(safetyTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authSession, loadDisplay]);

  useEffect(() => {
    if (!authSession) return;
    const channel = supabase
      .channel("classroom-display-events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "app_events" },
        () => loadDisplay(false),
      )
      .subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
    };
  }, [authSession, loadDisplay]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clock = useMemo(() => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now), [now]);
  const queue = data?.queue ?? [];
  const tables = data?.tables ?? [];
  const tableGroups = useMemo(() => groupByZone(tables), [tables]);
  const queueInfoByTableId = useMemo(() => {
    const info = new Map<string, { rank: number; requestCount: number }>();
    for (const [zone] of tableGroups) {
      queue
        .filter((request) => (request.zone?.trim() || "Other tables") === zone)
        .forEach((request, index) => info.set(request.table_id, { rank: index + 1, requestCount: request.request_count }));
    }
    return info;
  }, [queue, tableGroups]);

  const enterFullscreen = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  };

  if (authLoading || loading) return <div className="min-h-screen bg-[#10243c] flex items-center justify-center"><LoaderCircle className="w-12 h-12 animate-spin text-green-400" /></div>;

  if (!authSession) return (
    <div className="min-h-screen bg-[#10243c] text-white flex items-center justify-center p-6">
      <div className="text-center max-w-lg"><Users className="w-14 h-14 text-green-400 mx-auto mb-5" /><h1 className="text-3xl font-bold">Instructor sign-in required</h1><p className="text-slate-300 mt-3">Open the administration page and sign in before launching the classroom display.</p><a href="/admin" className="inline-flex mt-6 bg-green-500 text-[#10243c] font-bold px-5 py-3 rounded-xl items-center gap-2">Open Admin <ExternalLink className="w-4 h-4" /></a></div>
    </div>
  );

  if (forbidden) return <div className="min-h-screen bg-[#10243c] text-white flex items-center justify-center p-6"><div className="text-center"><AlertCircle className="w-14 h-14 text-amber-400 mx-auto mb-4" /><h1 className="text-2xl font-bold">Administrator access required</h1><a href="/admin" className="inline-block mt-5 underline text-green-300">Return to Admin</a></div></div>;

  return (
    <div className="h-screen overflow-hidden bg-slate-100 text-[#1e3a5f] p-3 md:p-4 flex flex-col">
      <header className="shrink-0 bg-white rounded-2xl shadow-sm border border-slate-200 px-4 py-2.5 flex items-center gap-3">
        <a href="/admin" title="Back to Admin" className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-gray-500"><ArrowLeft className="w-4.5 h-4.5" /></a>
        <div className="w-10 h-10 rounded-xl bg-[#67ad66] text-white flex items-center justify-center"><Users className="w-5 h-5" /></div>
        <div><p className="text-[10px] uppercase tracking-[0.2em] text-[#67ad66] font-semibold">Gross Anatomy Help Queue</p><h1 className="text-xl md:text-2xl font-bold leading-tight">{data?.session?.title ?? "Classroom Display"}</h1></div>
        <div className="ml-auto text-right"><p className="text-2xl md:text-3xl font-mono font-bold tabular-nums leading-none">{clock}</p><p className={`text-[10px] mt-1 flex items-center justify-end gap-1.5 ${realtimeConnected ? "text-green-600" : "text-amber-600"}`}><span className={`relative flex w-2 h-2 rounded-full ${realtimeConnected ? "bg-green-500" : "bg-amber-400"}`}>{realtimeConnected && <span className="absolute inset-0 rounded-full bg-green-400 animate-ping" />}</span>{realtimeConnected ? "LIVE" : "CONNECTING"}</p></div>
        <button onClick={enterFullscreen} className="ml-2 w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50" title="Full screen"><Maximize className="w-5 h-5" /></button>
      </header>

      {error && <div className="mt-4 bg-red-500/20 border border-red-400/30 text-red-100 rounded-xl px-4 py-3">{error}</div>}

      {!data?.session ? (
        <div className="flex-1 flex items-center justify-center text-center"><div><Clock className="w-20 h-20 text-slate-300 mx-auto mb-5" /><h2 className="text-4xl font-bold">No lab session is open</h2><p className="text-xl text-slate-400 mt-3">The display will update automatically when an instructor opens a session.</p></div></div>
      ) : (
        <main className="flex-1 mt-3 min-h-0 overflow-hidden">
          <section className="h-full min-h-0 bg-white rounded-2xl border border-slate-200 p-3 flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between mb-2">
              <h2 className="text-lg md:text-xl font-bold">Room overview</h2>
              <div className="flex items-center gap-3 text-[10px] 2xl:text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-700" />1st</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500" />2nd</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-300" />3rd</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-200" />Available</span>
              </div>
            </div>
            <div className="grid flex-1 min-h-0 gap-2" style={{ gridTemplateRows: `repeat(${Math.max(1, tableGroups.length)}, minmax(0, 1fr))` }}>
              {tableGroups.map(([zone, zoneTables], zoneIndex) => {
                const color = zoneStyle(zone, zoneIndex);
                const zoneRows = Math.max(1, Math.ceil(zoneTables.length / 5));
                return (
                  <div key={zone} className="min-h-0 rounded-xl border px-3 py-2 flex flex-col" style={{ backgroundColor: color.background, borderColor: color.border }}>
                    <p className="shrink-0 text-sm 2xl:text-base font-bold mb-1" style={{ color: color.accent }}>{zone}</p>
                    <div className="grid flex-1 min-h-0 grid-cols-5 gap-2" style={{ gridTemplateRows: `repeat(${zoneRows}, minmax(0, 1fr))` }}>
                      {zoneTables.map((table) => {
                        const queueInfo = queueInfoByTableId.get(table.id);
                        const waitingStyle = queueInfo
                          ? queueInfo.rank === 1
                            ? "bg-emerald-700 text-white ring-[3px] ring-emerald-900"
                            : queueInfo.rank === 2
                              ? "bg-emerald-500 text-white"
                              : queueInfo.rank === 3
                                ? "bg-emerald-300 text-emerald-950"
                                : "bg-white/90 text-gray-600 border border-white"
                          : "bg-white/90 text-gray-600 border border-white";
                        return (
                          <div key={table.id} className={`relative min-h-0 rounded-lg flex items-center justify-center text-4xl 2xl:text-5xl font-black transition-colors ${waitingStyle}`}>
                            <span className="truncate px-1">{table.label}</span>
                            {queueInfo && <span className="absolute right-2 top-2 min-w-8 h-8 px-1.5 rounded-full border-2 border-white bg-[#1e3a5f] text-white shadow flex items-center justify-center text-sm 2xl:text-base font-black tabular-nums">{queueInfo.requestCount}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
