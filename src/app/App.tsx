import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CircleCheckBig,
  Clock,
  HelpCircle,
  LoaderCircle,
  LockKeyhole,
  Send,
  UserMinus,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "../../utils/supabase/client";
import {
  EDGE_FUNCTION_BASE,
  TABLE_TOKEN_STORAGE_KEY,
  tableHeaders,
  formatCountdown,
  type SessionContext,
  type HelpRequest,
} from "./shared";
import { TableClaim } from "./components/TableClaim";
import { StudentRoomMap } from "./components/StudentRoomMap";
import { ZoneQueueTables } from "./components/ZoneQueueTables";

/* ──────────────────────── Main Student App ──────────────────────── */

export default function App() {
  const [tableToken, setTableToken] = useState<string | null>(() =>
    localStorage.getItem(TABLE_TOKEN_STORAGE_KEY)
  );
  const [context, setContext] = useState<SessionContext | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [problem, setProblem] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [showRequestSuccess, setShowRequestSuccess] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const clearInvalidToken = useCallback(() => {
    localStorage.removeItem(TABLE_TOKEN_STORAGE_KEY);
    setTableToken(null);
  }, []);

  const loadContext = useCallback(
    async (showLoading = false, tokenOverride?: string | null) => {
      const token = tokenOverride === undefined ? tableToken : tokenOverride;
      if (showLoading) setContextLoading(true);
      setContextError(null);
      try {
        const response = await fetch(`${EDGE_FUNCTION_BASE}/session/current`, {
          headers: tableHeaders(token, false),
        });
        if (!response.ok) throw new Error();
        const result = (await response.json()) as SessionContext;
        setContext(result);
        if (result.session && token && !result.assignment) clearInvalidToken();
      } catch {
        setContextError("Could not load the current lab session.");
      } finally {
        if (showLoading) setContextLoading(false);
      }
    },
    [clearInvalidToken, tableToken]
  );

  const loadQueue = useCallback(async () => {
    if (!context?.session || !context.assignment) return;
    try {
      const response = await fetch(`${EDGE_FUNCTION_BASE}/queue`, {
        headers: tableHeaders(tableToken, false),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (Array.isArray(data)) setRequests(data);
    } catch {
      setContextError("Could not load the queue.");
    }
  }, [context?.assignment, context?.session, tableToken]);

  // Initial load
  useEffect(() => {
    loadContext(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load queue when assignment changes
  useEffect(() => {
    if (context?.assignment) loadQueue();
  }, [context?.assignment?.id, loadQueue]);

  // Polling fallback — also refresh immediately when tab regains focus
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        loadContext(false);
        loadQueue();
      }
    };

    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadContext, loadQueue]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("gross-queue-anonymous-events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "app_events" },
        (payload) => {
          const event = payload.new as { event_type?: string };
          if (event.event_type === "queue") loadQueue();
          if (event.event_type === "session") loadContext(false);
        }
      )
      .subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadContext, loadQueue]);

  // Tick for countdown timers
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* ──────────── Handlers ──────────── */

  const handleClaimed = async (token: string) => {
    localStorage.setItem(TABLE_TOKEN_STORAGE_KEY, token);
    setTableToken(token);
    await loadContext(true, token);
  };

  const handleExpiredAccess = async (response: Response) => {
    if (response.status !== 401) return false;
    clearInvalidToken();
    setRequests([]);
    await loadContext(false, null);
    return true;
  };

  const sendRequest = async () => {
    if (
      !tableToken ||
      problem.trim().length < 10 ||
      isSubmitting ||
      context?.session?.requests_status !== "open"
    )
      return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`${EDGE_FUNCTION_BASE}/queue`, {
        method: "POST",
        headers: tableHeaders(tableToken),
        body: JSON.stringify({
          problem: problem.trim(),
          problem_category: "other",
        }),
      });
      if (!response.ok) {
        if (await handleExpiredAccess(response)) return;
        const result = await response.json().catch(() => ({}));
        setSubmitError(result.error ?? "Could not submit the request.");
        return;
      }
      setProblem("");
      setShowRequestSuccess(true);
      await Promise.all([loadContext(), loadQueue()]);
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const ownRequest = useMemo(
    () =>
      requests.find(
        (request) => request.table_id === context?.assignment?.id
      ) ?? null,
    [requests, context?.assignment]
  );
  const ownZoneRank = ownRequest
    ? requests
        .filter((request) => request.zone === ownRequest.zone)
        .findIndex((request) => request.id === ownRequest.id) + 1
    : 0;
  const cooldownRemaining = context?.usage?.next_allowed_at
    ? Math.max(
        0,
        Math.ceil(
          (new Date(context.usage.next_allowed_at).getTime() - now) / 1000
        )
      )
    : 0;

  const markInstructorArrived = async () => {
    if (!tableToken || !ownRequest || isCompleting) return;
    setIsCompleting(true);
    setSubmitError(null);
    try {
      const response = await fetch(
        `${EDGE_FUNCTION_BASE}/queue/${ownRequest.id}/arrive`,
        { method: "PATCH", headers: tableHeaders(tableToken) }
      );
      if (!response.ok) {
        if (await handleExpiredAccess(response)) return;
        setSubmitError("Could not record the instructor's arrival.");
        return;
      }
      await Promise.all([loadContext(), loadQueue()]);
    } finally {
      setIsCompleting(false);
    }
  };

  const cancelRequest = async () => {
    if (!tableToken || !ownRequest || isCancelling) return;
    setIsCancelling(true);
    setSubmitError(null);
    try {
      const response = await fetch(
        `${EDGE_FUNCTION_BASE}/queue/${ownRequest.id}/cancel`,
        { method: "PATCH", headers: tableHeaders(tableToken) }
      );
      if (!response.ok) {
        if (await handleExpiredAccess(response)) return;
        setSubmitError("Could not cancel this request.");
        return;
      }
      await Promise.all([loadContext(), loadQueue()]);
      setShowCancelConfirm(false);
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setIsCancelling(false);
    }
  };

  const releaseRepresentative = async () => {
    if (!tableToken || ownRequest || isReleasing) return;
    setIsReleasing(true);
    setContextError(null);
    try {
      const response = await fetch(
        `${EDGE_FUNCTION_BASE}/session/current/assignment`,
        {
          method: "DELETE",
          headers: tableHeaders(tableToken, false),
        }
      );
      if (!response.ok) {
        if (await handleExpiredAccess(response)) return;
        const result = await response.json().catch(() => ({}));
        setContextError(
          result.error ?? "Could not release this table. Please try again."
        );
        return;
      }
      setShowReleaseConfirm(false);
      clearInvalidToken();
      setRequests([]);
      setProblem("");
      setSubmitError(null);
      setContext((current) =>
        current ? { ...current, assignment: null, usage: null } : current
      );
    } catch {
      setContextError(
        "Network error. Please check your connection and try again."
      );
    } finally {
      setIsReleasing(false);
    }
  };

  /* ──────────── Render ──────────── */

  if (contextLoading)
    return (
      <div className="min-h-screen bg-pink-50 flex items-center justify-center">
        <LoaderCircle className="w-9 h-9 animate-spin text-[#67ad66]" />
      </div>
    );

  if (contextError && !context)
    return (
      <div className="min-h-screen bg-pink-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl p-8 text-center shadow-xl">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p>{contextError}</p>
          <button
            onClick={() => loadContext(true)}
            className="mt-4 underline text-[#c96da0]"
          >
            Retry
          </button>
        </div>
      </div>
    );

  if (!context?.session)
    return (
      <div className="min-h-screen bg-pink-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl p-8 text-center shadow-xl max-w-md">
          <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-[#1e3a5f]">
            No lab session is open
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            An instructor must open a session before students can choose a
            table.
          </p>
          <a
            href="/"
            className="inline-block mt-5 text-sm underline text-gray-500"
          >
            Back to home
          </a>
        </div>
      </div>
    );

  if (!context.assignment)
    return (
      <TableClaim
        context={context}
        edgeFunctionBase={EDGE_FUNCTION_BASE}
        tableHeaders={tableHeaders}
        onClaimed={handleClaimed}
      />
    );

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-pink-100 to-pink-200 p-4 md:p-6">
      {/* ── Header ── */}
      <header className="max-w-7xl mx-auto bg-white rounded-3xl shadow-2xl px-5 py-3 flex items-center mb-5">
        <a
          href="/"
          title="Back to home"
          className="mr-3 w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400"
        >
          <ArrowLeft className="w-4 h-4" />
        </a>
        <Users className="w-5 h-5 text-[#67ad66] mr-2" />
        <span className="text-[#1e3a5f] font-semibold">
          Gross Anatomy Help Queue
        </span>
        <div className="ml-auto text-right">
          <p className="text-[10px] uppercase text-gray-400">Your table</p>
          <p className="font-bold text-[#c96da0]">
            {context.assignment.label}
          </p>
        </div>
      </header>

      {contextError && (
        <div className="max-w-7xl mx-auto mb-4 bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm">
          {contextError}
        </div>
      )}

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Session Info + Room Map ── */}
        <section className="bg-white rounded-3xl shadow-2xl p-5">
          <h2 className="font-semibold text-[#1e3a5f] mb-4">Lab session</h2>
          <p className="font-bold text-lg">{context.session.title}</p>
          <div className="mt-4 space-y-3 text-sm text-gray-600">
            <p>
              <span className="text-gray-400">Help requests:</span>{" "}
              <span
                className={`font-semibold ${
                  context.session.requests_status === "open"
                    ? "text-green-600"
                    : "text-amber-600"
                }`}
              >
                {context.session.requests_status === "open"
                  ? "Open"
                  : "Not open yet"}
              </span>
            </p>
            <p>
              <span className="text-gray-400">Cooldown:</span>{" "}
              {context.session.cooldown_seconds
                ? `${context.session.cooldown_seconds} seconds`
                : "None"}
            </p>
          </div>
          <button
            onClick={() => setShowReleaseConfirm(true)}
            disabled={Boolean(ownRequest) || isReleasing}
            title={
              ownRequest
                ? "Cancel the waiting request or record the instructor's arrival first."
                : "Stop representing this table on this device"
            }
            className="mt-4 w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <UserMinus className="h-4 w-4" />
            Release this table
          </button>
          {ownRequest && (
            <p className="mt-2 text-[11px] leading-4 text-gray-400">
              Finish or cancel the waiting request before releasing this table.
            </p>
          )}
          <StudentRoomMap
            tables={context.tables}
            entries={requests}
            activeTableId={context.assignment.id}
          />
        </section>

        {/* ── Queue Status + Help Request Form ── */}
        <section className="space-y-5">
          <div className="bg-white rounded-3xl shadow-2xl p-5">
            <h2 className="font-semibold text-[#1e3a5f] mb-3">สถานะคิว</h2>
            {ownRequest ? (
              <>
                <p className="text-green-700 text-base font-bold">
                  โต๊ะของคุณอยู่ลำดับที่ {ownZoneRank} ใน{" "}
                  {ownRequest.zone ?? "โซนนี้"}
                </p>
                <div className="mt-4 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-center">
                  <p className="text-base md:text-lg font-black text-red-600">
                    เมื่ออาจารย์มาถึง กรุณากด “อาจารย์มาถึงแล้ว” ทันที
                  </p>
                  <p className="mt-1 text-xs md:text-sm font-semibold text-red-500">
                    เพื่อป้องกันไม่ให้อาจารย์ท่านอื่นเดินมาที่โต๊ะซ้ำ
                  </p>
                </div>
                <div className="mt-4 space-y-2.5">
                  <button
                    onClick={markInstructorArrived}
                    disabled={isCompleting || isCancelling}
                    className="w-full bg-[#54a853] text-white text-lg font-bold py-4 rounded-xl shadow-md transition-colors hover:bg-[#478f47] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <CircleCheckBig className="h-5 w-5" />
                    {isCompleting ? "กำลังบันทึก…" : "อาจารย์มาถึงแล้ว"}
                  </button>
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={isCompleting || isCancelling}
                    className="w-full bg-white text-red-600 border-2 border-red-200 text-base font-bold py-3 rounded-xl transition-colors hover:bg-red-50 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <XCircle className="h-5 w-5" />
                    ยกเลิกคิว
                  </button>
                </div>
                <p className="text-xs text-red-500 font-medium mt-2 text-center">
                  หากยกเลิก
                  คำขอจะถูกนำออกจากคิวและเริ่มนับคูลดาวน์ก่อนขอใหม่ได้อีกครั้ง
                </p>
                {submitError && (
                  <p className="text-xs text-red-500 mt-2">{submitError}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">
                โต๊ะของคุณยังไม่ได้ส่งคำขอความช่วยเหลือ
              </p>
            )}
          </div>

          {/* Requests closed notice */}
          {!ownRequest &&
            context.session.requests_status === "closed" && (
              <div className="bg-white rounded-3xl shadow-2xl p-6 text-center">
                <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
                  <LockKeyhole className="w-6 h-6 text-amber-500" />
                </div>
                <h2 className="font-semibold text-[#1e3a5f] mt-3">
                  Help requests are not open yet
                </h2>
                <p className="text-sm text-gray-500 mt-2">
                  Please continue working with your group. The form will become
                  available automatically when your instructor opens it.
                </p>
              </div>
            )}

          {/* Help request form */}
          {!ownRequest &&
            context.session.requests_status === "open" && (
              <div className="bg-white rounded-3xl shadow-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <HelpCircle className="w-5 h-5 text-[#67ad66]" />
                  <h2 className="font-semibold text-[#1e3a5f]">
                    Ask for help
                  </h2>
                </div>
                <label className="text-xs font-medium text-gray-500">
                  Describe what your table needs help with
                </label>
                <textarea
                  value={problem}
                  onChange={(event) => setProblem(event.target.value)}
                  maxLength={300}
                  rows={4}
                  placeholder="Describe what your table needs help with…"
                  disabled={cooldownRemaining > 0}
                  className="w-full mt-1 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm outline-none focus:ring-2 focus:ring-green-300 resize-none disabled:opacity-60"
                />
                <p className="text-[11px] text-gray-400 mt-1 text-right">
                  {problem.trim().length}/300 · minimum 10 characters
                </p>
                {cooldownRemaining > 0 && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    You can request help again when the countdown ends.
                  </p>
                )}
                {submitError && (
                  <p className="text-xs text-red-500 mt-2">{submitError}</p>
                )}
                <button
                  onClick={sendRequest}
                  disabled={
                    isSubmitting ||
                    problem.trim().length < 10 ||
                    cooldownRemaining > 0
                  }
                  className="w-full mt-3 bg-[#c96da0] text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  {isSubmitting
                    ? "Sending…"
                    : cooldownRemaining > 0
                      ? `Ask for Help in ${formatCountdown(cooldownRemaining)}`
                      : "Ask for Help"}
                </button>
              </div>
            )}
        </section>

        {/* ── Zone Queue Overview ── */}
        <section className="min-h-[560px]">
          <ZoneQueueTables
            entries={requests}
            tables={context.tables}
            activeTableId={context.assignment.id}
            isLive={realtimeConnected}
          />
        </section>
      </main>

      {/* ── Request Submitted Reminder ── */}
      {showRequestSuccess && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm p-4 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="request-success-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600">
              <CircleCheckBig className="h-8 w-8" />
            </div>
            <h2
              id="request-success-title"
              className="mt-4 text-xl font-black text-[#1e3a5f]"
            >
              ส่งคำขอเรียบร้อยแล้ว
            </h2>
            <div className="mt-4 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-4">
              <p className="text-base font-black leading-7 text-red-600">
                เมื่ออาจารย์มาถึงโต๊ะ กรุณากดปุ่ม “อาจารย์มาถึงแล้ว” ทันที
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-red-500">
                เพื่อป้องกันไม่ให้อาจารย์ท่านอื่นเดินมาที่โต๊ะซ้ำ
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRequestSuccess(false)}
              className="mt-5 w-full rounded-xl bg-[#54a853] py-3.5 text-base font-bold text-white transition-colors hover:bg-[#478f47]"
            >
              เข้าใจแล้ว
            </button>
          </div>
        </div>
      )}

      {/* ── Cancel Request Confirmation ── */}
      {showCancelConfirm && ownRequest && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm p-4 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-cancel-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2
              id="student-cancel-title"
              className="text-lg font-bold text-[#1e3a5f]"
            >
              ยกเลิกคำขอนี้?
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              คำขอจะถูกนำออกจากคิวและหยุดนับเวลารอ
              จากนั้นระบบจะเริ่มนับคูลดาวน์ก่อนที่โต๊ะนี้จะส่งคำขอใหม่ได้
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                disabled={isCancelling}
                className="rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50"
              >
                ไม่ยกเลิก
              </button>
              <button
                onClick={cancelRequest}
                disabled={isCancelling}
                className="rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isCancelling ? "กำลังยกเลิก…" : "ยืนยันการยกเลิก"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Release Table Confirmation ── */}
      {showReleaseConfirm && !ownRequest && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm p-4 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-release-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2
              id="student-release-title"
              className="text-lg font-bold text-[#1e3a5f]"
            >
              Release table {context.assignment.label}?
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              This device will stop representing the table, and another student
              can claim it using the table PIN. Any cooldown already recorded for
              the table will remain.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowReleaseConfirm(false)}
                disabled={isReleasing}
                className="rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50"
              >
                Keep this table
              </button>
              <button
                onClick={releaseRepresentative}
                disabled={isReleasing}
                className="rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isReleasing ? "Releasing…" : "Release table"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
