import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AlertCircle, ArrowLeft, Clock, ExternalLink, LoaderCircle, Maximize, Users, Volume2, VolumeX } from "lucide-react";
import { projectId } from "../../utils/supabase/info";
import { supabase } from "../../utils/supabase/client";
import studentQueueQr from "../assets/student-queue-qr.jpg";
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

function ordinalSuffix(rank: number) {
  const lastTwoDigits = rank % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return "th";
  if (rank % 10 === 1) return "st";
  if (rank % 10 === 2) return "nd";
  if (rank % 10 === 3) return "rd";
  return "th";
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
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const displaySessionIdRef = useRef<string | null>(null);
  const seenRequestIdsRef = useRef<Set<string>>(new Set());

  const playNotificationChime = useCallback(async () => {
    const audioContext = audioContextRef.current;
    if (!audioContext) return;
    if (audioContext.state === "suspended") {
      try {
        await audioContext.resume();
      } catch {
        return;
      }
    }
    if (audioContext.state !== "running") return;

    const startAt = audioContext.currentTime;
    const notes = [
      { frequency: 784, offset: 0, duration: 0.2 },
      { frequency: 1046.5, offset: 0.22, duration: 0.32 },
    ];

    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const noteStart = startAt + note.offset;
      const noteEnd = noteStart + note.duration;

      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.14, noteStart + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02);
    }
  }, []);

  const toggleSound = async () => {
    if (soundEnabled) {
      setSoundEnabled(false);
      return;
    }

    try {
      const audioContext = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();
      setSoundEnabled(true);
      void playNotificationChime();
    } catch {
      setError("Could not enable notification sound on this display.");
    }
  };

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

  useEffect(() => () => {
    void audioContextRef.current?.close();
  }, []);

  const clock = useMemo(() => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now), [now]);
  const queue = data?.queue ?? [];
  const tables = data?.tables ?? [];
  const tableGroups = useMemo(() => groupByZone(tables), [tables]);
  const queueInfoByTableId = useMemo(() => {
    const info = new Map<string, { rank: number }>();
    for (const [zone] of tableGroups) {
      queue
        .filter((request) => (request.zone?.trim() || "Other tables") === zone)
        .forEach((request, index) => info.set(request.table_id, { rank: index + 1 }));
    }
    return info;
  }, [queue, tableGroups]);

  useEffect(() => {
    const sessionId = data?.session?.id ?? null;
    const currentRequestIds = new Set(queue.map((request) => request.id));

    if (displaySessionIdRef.current !== sessionId) {
      displaySessionIdRef.current = sessionId;
      seenRequestIdsRef.current = currentRequestIds;
      return;
    }

    const hasNewRequest = queue.some((request) => !seenRequestIdsRef.current.has(request.id));
    seenRequestIdsRef.current = currentRequestIds;
    if (hasNewRequest && soundEnabled) void playNotificationChime();
  }, [data?.session?.id, queue, playNotificationChime, soundEnabled]);

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
        <div className="ml-auto hidden lg:flex items-center gap-3">
          <div className="relative h-20 w-28 shrink-0 2xl:h-24 2xl:w-32">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
              <img src={studentQueueQr} alt="QR code for the student queue" className="w-28 h-28 2xl:w-32 2xl:h-32 rounded-md object-contain" />
            </div>
          </div>
          <div className="max-w-28 leading-tight">
            <p className="text-xs 2xl:text-sm uppercase tracking-wide text-[#67ad66] font-bold">Student queue</p>
            <p className="text-sm 2xl:text-base font-semibold text-slate-600 mt-1">Scan to request help</p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleSound}
          className={`ml-1 h-10 px-3 rounded-xl border flex items-center gap-2 text-xs font-bold transition-colors ${soundEnabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
          title={soundEnabled ? "Turn notification sound off" : "Turn notification sound on"}
          aria-pressed={soundEnabled}
        >
          {soundEnabled ? <Volume2 className="w-4.5 h-4.5" /> : <VolumeX className="w-4.5 h-4.5" />}
          <span className="hidden xl:inline">{soundEnabled ? "Sound on" : "Enable sound"}</span>
        </button>
        <div className="text-right"><p className="text-2xl md:text-3xl font-mono font-bold tabular-nums leading-none">{clock}</p><p className={`text-[10px] mt-1 flex items-center justify-end gap-1.5 ${realtimeConnected ? "text-green-600" : "text-amber-600"}`}><span className={`relative flex w-2 h-2 rounded-full ${realtimeConnected ? "bg-green-500" : "bg-amber-400"}`}>{realtimeConnected && <span className="absolute inset-0 rounded-full bg-green-400 animate-ping" />}</span>{realtimeConnected ? "LIVE" : "CONNECTING"}</p></div>
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
                <span className="font-medium text-slate-500">Queue order within each zone</span>
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
                            {queueInfo && (
                              <span className="absolute right-2 top-2 min-w-9 h-9 2xl:min-w-10 2xl:h-10 px-2 rounded-full border-2 border-white bg-[#1e3a5f] text-white shadow flex items-center justify-center font-black tabular-nums">
                                <span className="text-base 2xl:text-lg leading-none">{queueInfo.rank}</span>
                                <sup className="ml-0.5 -mt-2 text-[8px] 2xl:text-[9px] leading-none">{ordinalSuffix(queueInfo.rank)}</sup>
                              </span>
                            )}
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
