import { Hono, type Context } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();
const ROUTE_PREFIX = "/make-server-6a67b1c8";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROBLEM_CATEGORIES = new Set([
  "identify_structure",
  "dissection_technique",
  "anatomical_relationship",
  "clarify_instructions",
  "specimen_issue",
  "other",
]);

const GROSS_2569_ROWS = [
  [1, 2, 3, 4, 5, 6],
  [12, 11, 10, 9, 8, 7],
  [13, 14, 15, 16, 17, 18],
  [24, 23, 22, 21, 20, 19],
  [25, 26, 27, 28, 29, 30],
  [35, 34, 33, 32, 31],
  [36, 37, 38, 39, 40],
];

type RoomLayoutTable = { label: string; zone: string; sort_order: number };
type RoomLayout = { id: string; tables: RoomLayoutTable[] };

const ROOM_LAYOUTS: Record<string, RoomLayout> = {
  "2569": {
    id: "2569",
    tables: GROSS_2569_ROWS.flat().map((tableNumber, index) => ({
      label: String(tableNumber),
      zone: tableNumber <= 12 ? "Zone A" : tableNumber <= 24 ? "Zone B" : tableNumber <= 35 ? "Zone C" : "Zone D",
      sort_order: index + 1,
    })),
  },
};

app.use("*", logger(console.log));
const ALLOWED_ORIGINS = [
  Deno.env.get("ALLOWED_ORIGIN") || "*",
  "http://localhost:5173",
  "http://localhost:4173",
];

app.use(
  "/*",
  cors({
    origin: (requestOrigin) => {
      if (ALLOWED_ORIGINS.includes("*")) return "*";
      return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
    },
    allowHeaders: ["Content-Type", "Authorization", "X-Table-Token"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function db() {
  return supabaseAdmin;
}

type AuthenticatedUser = { userId: string; email: string; emailDomain: string };

async function requireGoogleUser(c: Context): Promise<AuthenticatedUser | Response> {
  const authorization = c.req.header("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const token = authorization.slice("Bearer ".length).trim();
  const { data, error } = await db().auth.getUser(token);
  const user = data.user;

  if (error || !user) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  const googleIdentity = user.identities?.find((identity) => identity.provider === "google");
  const email = user.email?.toLowerCase() ?? "";
  const emailDomain = email.split("@").at(-1);
  const hostedDomain = googleIdentity?.identity_data?.hd?.toLowerCase();

  if (!googleIdentity || !user.email_confirmed_at || !emailDomain) {
    return c.json({ error: "This account is not permitted" }, 403);
  }

  if (hostedDomain && hostedDomain !== emailDomain) {
    return c.json({ error: "Google Workspace domain mismatch" }, 403);
  }

  return { userId: user.id, email, emailDomain };
}

async function requireAdmin(c: Context): Promise<AuthenticatedUser | Response> {
  const user = await requireGoogleUser(c);
  if (user instanceof Response) return user;

  const [userAccess, emailAccess] = await Promise.all([
    db()
      .from("app_admins")
      .select("user_id")
      .eq("user_id", user.userId)
      .eq("active", true)
      .maybeSingle(),
    db()
      .from("admin_email_allowlist")
      .select("email")
      .eq("email", user.email)
      .eq("active", true)
      .maybeSingle(),
  ]);

  if (userAccess.error || emailAccess.error) {
    return c.json({ error: "Failed to verify administrator access" }, 500);
  }
  if (!userAccess.data && !emailAccess.data) {
    return c.json({ error: "Administrator access required" }, 403);
  }
  return user;
}

function numericTableCompare(left: { label: string }, right: { label: string }) {
  const leftNumber = Number(left.label);
  const rightNumber = Number(right.label);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function anonymousAssignment(c: Context, sessionId: string) {
  const rawToken = (c.req.header("X-Table-Token") ?? "").trim();
  if (!UUID_RE.test(rawToken)) return { assignment: null, error: null };

  const tokenHash = await sha256(rawToken);
  const { data, error } = await db()
    .from("student_table_assignments")
    .select("id, table_id")
    .eq("session_id", sessionId)
    .eq("claim_token_hash", tokenHash)
    .maybeSingle();
  return { assignment: data, error };
}

async function getOpenSession() {
  return db()
    .from("lab_sessions")
    .select("id, title, status, starts_at, ends_at, requests_open_at, requests_close_at, cooldown_seconds, queue_priority_display")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

function requestWindowIsOpen(session: Record<string, any>) {
  const now = Date.now();
  if (session.requests_open_at && now < new Date(session.requests_open_at).getTime()) return false;
  if (session.requests_close_at && now >= new Date(session.requests_close_at).getTime()) return false;
  return true;
}

function requestToApi(row: Record<string, any>) {
  const table = row.table as { label?: string; zone?: string | null } | null;
  return {
    id: row.id,
    session_id: row.session_id,
    table_id: row.table_id,
    table_label: table?.label ?? (row.group_number ? String(row.group_number) : "Unknown"),
    zone: table?.zone ?? row.zone ?? null,
    problem: row.problem,
    status: row.status,
    problem_category: row.problem_category ?? "other",
    created_at: row.created_at,
    instructor_arrived_at: row.instructor_arrived_at ?? null,
    completed_at: row.completed_at,
  };
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function arrivalTime(request: Record<string, any>) {
  return request.instructor_arrived_at ?? (request.status === "completed" ? request.completed_at : null);
}

function cooldownStartTime(request: Record<string, any>) {
  return arrivalTime(request) ?? request.cancelled_at ?? request.created_at;
}

function waitSeconds(request: Record<string, any>) {
  const arrivedAt = arrivalTime(request);
  return arrivedAt
    ? Math.max(0, Math.round((new Date(arrivedAt).getTime() - new Date(request.created_at).getTime()) / 1000))
    : null;
}

function checkConstraintReference(error: { code?: string; message?: string }) {
  if (error.code !== "23514") return error.code || "unknown";
  const constraint = error.message?.match(/constraint\s+["']([^"']+)["']/i)?.[1];
  return constraint ? `${error.code}:${constraint}` : error.code;
}

app.get(`${ROUTE_PREFIX}/health`, (c) => c.json({ status: "ok" }));

app.get(`${ROUTE_PREFIX}/admin/status`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  return c.json({ admin: true, email: admin.email });
});

app.get(`${ROUTE_PREFIX}/admin/access`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const { data, error } = await db()
    .from("admin_email_allowlist")
    .select("email, role, active, created_at")
    .order("email", { ascending: true });
  if (error) return c.json({ error: "Failed to load administrator access" }, 500);
  return c.json(data ?? []);
});

app.post(`${ROUTE_PREFIX}/admin/access`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role === "instructor" ? "instructor" : "admin";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return c.json({ error: "Enter a valid email address" }, 400);
  }
  const { data, error } = await db()
    .from("admin_email_allowlist")
    .upsert({ email, role, active: true }, { onConflict: "email" })
    .select("email, role, active, created_at")
    .single();
  if (error) return c.json({ error: "Failed to grant administrator access" }, 500);
  return c.json(data, 201);
});

app.delete(`${ROUTE_PREFIX}/admin/access`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return c.json({ error: "Email is required" }, 400);
  if (email === admin.email) return c.json({ error: "You cannot remove your own active access" }, 409);
  const { error } = await db().from("admin_email_allowlist").delete().eq("email", email);
  if (error) return c.json({ error: "Failed to remove administrator access" }, 500);
  return c.json({ ok: true });
});

app.get(`${ROUTE_PREFIX}/admin/table-pins`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const layoutId = c.req.query("layout_id")?.trim() || "2569";
  const layout = ROOM_LAYOUTS[layoutId];
  if (!layout) return c.json({ error: "Unknown room layout" }, 400);

  const labels = layout.tables.map((table) => table.label);
  const { data: existing, error: existingError } = await db()
    .from("permanent_table_pins")
    .select("table_label, pin_code")
    .in("table_label", labels);
  if (existingError) return c.json({ error: "Failed to load permanent table PINs" }, 500);

  const pins = [...(existing ?? [])];
  const existingLabels = new Set(pins.map((item) => item.table_label));
  for (const label of labels) {
    if (existingLabels.has(label)) continue;
    const { data: pin, error } = await db().rpc("get_or_create_permanent_table_pin", { p_label: label });
    if (error || typeof pin !== "string") return c.json({ error: "Failed to prepare permanent table PINs" }, 500);
    pins.push({ table_label: label, pin_code: pin });
  }

  return c.json(pins
    .map((item) => ({ label: item.table_label, pin: item.pin_code }))
    .sort(numericTableCompare));
});

app.patch(`${ROUTE_PREFIX}/admin/table-pins/:label`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const label = c.req.param("label").trim();
  const validLabels = new Set(Object.values(ROOM_LAYOUTS).flatMap((layout) => layout.tables.map((table) => table.label)));
  if (!validLabels.has(label)) return c.json({ error: "Unknown table" }, 400);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!/^\d{6}$/.test(pin)) return c.json({ error: "PIN must contain exactly 6 digits" }, 400);

  const { data: currentPin, error: currentPinError } = await db()
    .from("permanent_table_pins")
    .select("pin_code")
    .eq("table_label", label)
    .maybeSingle();
  if (currentPinError) return c.json({ error: "Failed to load the current PIN" }, 500);
  if (!currentPin) return c.json({ error: "Open this room layout's PIN list before editing it" }, 404);
  if (currentPin.pin_code === pin) return c.json({ ok: true, label, pin });

  const { data: tables, error: tablesError } = await db().from("lab_tables").select("id").eq("label", label);
  if (tablesError) return c.json({ error: "Failed to load tables using this PIN" }, 500);

  const rotatedTableIds: string[] = [];
  for (const table of tables ?? []) {
    const { error } = await db().rpc("rotate_lab_table_pin", { p_table_id: table.id, p_pin: pin });
    if (error) {
      for (const tableId of rotatedTableIds) {
        await db().rpc("rotate_lab_table_pin", { p_table_id: tableId, p_pin: currentPin.pin_code });
      }
      return c.json({ error: "Failed to update the table PIN" }, 500);
    }
    rotatedTableIds.push(table.id);
  }

  const { error: updateError } = await db()
    .from("permanent_table_pins")
    .update({ pin_code: pin, updated_at: new Date().toISOString() })
    .eq("table_label", label);
  if (updateError) {
    for (const tableId of rotatedTableIds) {
      await db().rpc("rotate_lab_table_pin", { p_table_id: tableId, p_pin: currentPin.pin_code });
    }
    return c.json({ error: "Failed to save the permanent PIN" }, 500);
  }

  return c.json({ ok: true, label, pin });
});

app.get(`${ROUTE_PREFIX}/admin/sessions`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  const [sessionsResult, tablesResult, requestsResult, assignmentsResult] = await Promise.all([
    db().from("lab_sessions").select("id, title, status, starts_at, ends_at, requests_open_at, requests_close_at, cooldown_seconds, queue_priority_display, created_at, archived_at").order("created_at", { ascending: false }),
    db().from("lab_tables").select("id, session_id, label, zone, sort_order, cooldown_reset_at").order("sort_order", { ascending: true }),
    db().from("help_requests").select("id, session_id, table_id, status, problem_category, created_at, instructor_arrived_at"),
    db().from("student_table_assignments").select("session_id, table_id"),
  ]);
  if (sessionsResult.error || tablesResult.error || requestsResult.error || assignmentsResult.error) {
    return c.json({ error: "Failed to load admin sessions" }, 500);
  }

  return c.json((sessionsResult.data ?? []).map((session) => ({
    ...session,
    tables: (tablesResult.data ?? []).filter((table) => table.session_id === session.id).map((table) => {
      const tableRequests = (requestsResult.data ?? []).filter((request) => request.table_id === table.id);
      const waitingRequest = tableRequests.find((request) => request.status === "waiting");
      return {
        ...table,
        request_count: tableRequests.length,
        waiting_request_id: waitingRequest?.id ?? null,
        waiting_since: waitingRequest?.created_at ?? null,
        representative_claimed: (assignmentsResult.data ?? []).some((assignment) => assignment.table_id === table.id),
      };
    }).sort(numericTableCompare),
  })));
});

app.get(`${ROUTE_PREFIX}/admin/display`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  const { data: session, error: sessionError } = await getOpenSession();
  if (sessionError) return c.json({ error: "Failed to load the lab session" }, 500);
  if (!session) return c.json({ session: null, queue: [] });

  const [queueResult, tablesResult, requestHistoryResult] = await Promise.all([
    db()
      .from("help_requests")
      .select("id, session_id, table_id, group_number, zone, problem, problem_category, status, created_at, instructor_arrived_at, completed_at, table:lab_tables(label, zone)")
      .eq("session_id", session.id)
      .eq("status", "waiting")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    db()
      .from("lab_tables")
      .select("id, label, zone, sort_order, cooldown_reset_at")
      .eq("session_id", session.id)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true }),
    db()
      .from("help_requests")
      .select("table_id")
      .eq("session_id", session.id),
  ]);

  if (queueResult.error || tablesResult.error || requestHistoryResult.error) {
    console.error("GET /admin/display db error:", queueResult.error?.code ?? tablesResult.error?.code ?? requestHistoryResult.error?.code);
    return c.json({ error: "Failed to load the classroom display" }, 500);
  }

  const requestCounts = new Map<string, number>();
  for (const request of requestHistoryResult.data ?? []) {
    if (!request.table_id) continue;
    requestCounts.set(request.table_id, (requestCounts.get(request.table_id) ?? 0) + 1);
  }

  return c.json({
    session,
    tables: tablesResult.data ?? [],
    queue: (queueResult.data ?? []).map((request) => ({
      ...requestToApi(request),
      request_count: requestCounts.get(request.table_id) ?? 1,
    })),
  });
});

app.post(`${ROUTE_PREFIX}/admin/sessions`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const cooldownSeconds = Number(body.cooldown_seconds);
  const requestedLayoutId = typeof body.layout_id === "string" ? body.layout_id.trim() : "";
  const layout = ROOM_LAYOUTS[requestedLayoutId];

  if (
    title.length < 3 || title.length > 100 ||
    !Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 21600 ||
    !layout
  ) {
    return c.json({ error: "Invalid session settings" }, 400);
  }

  const tables = layout.tables;

  const { data: session, error: sessionError } = await db()
    .from("lab_sessions")
    .insert({ title, cooldown_seconds: cooldownSeconds, room_layout_id: layout.id, status: "draft" })
    .select("id, title, status, cooldown_seconds")
    .single();
  if (sessionError || !session) return c.json({ error: "Failed to create the session" }, 500);

  const pins: Array<{ table_id: string; label: string; zone: string | null; pin: string }> = [];
  for (const table of tables) {
    const { data: pin, error: pinError } = await db().rpc("get_or_create_permanent_table_pin", {
      p_label: table.label,
    });
    if (pinError || typeof pin !== "string") {
      await db().from("lab_sessions").delete().eq("id", session.id);
      console.error("POST /admin/sessions permanent PIN error:", pinError?.code);
      return c.json({ error: "Failed to load permanent table PINs" }, 500);
    }
    const { data: tableId, error } = await db().rpc("create_lab_table_with_pin", {
      p_session_id: session.id,
      p_label: table.label,
      p_zone: table.zone,
      p_sort_order: table.sort_order,
      p_pin: pin,
    });
    if (error || !tableId) {
      await db().from("lab_sessions").delete().eq("id", session.id);
      console.error("POST /admin/sessions table error:", error?.code);
      return c.json({ error: "Failed to create session tables" }, 500);
    }
    pins.push({ table_id: tableId, label: table.label, zone: table.zone || null, pin });
  }

  return c.json({
    session: { ...session, room_layout_id: layout.id },
    pins: pins.sort(numericTableCompare),
  }, 201);
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/open`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);
  const { error } = await db().rpc("open_lab_session", { p_session_id: id });
  if (error) return c.json({ error: "Failed to open the session" }, 500);
  return c.json({ ok: true });
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/close`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);
  const { data: ended, error } = await db().rpc("end_lab_session", { p_session_id: id, p_admin_id: admin.userId });
  if (error) return c.json({ error: "Failed to close the session" }, 500);
  if (!ended) return c.json({ error: "Open or draft session not found" }, 404);
  return c.json({ ok: true });
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/archive`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);
  const archivedAt = new Date().toISOString();
  const { data, error } = await db()
    .from("lab_sessions")
    .update({ status: "closed", requests_open_at: null, requests_close_at: archivedAt, archived_at: archivedAt })
    .eq("id", id)
    .in("status", ["draft", "closed"])
    .select("id")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to archive the session" }, 500);
  if (!data) return c.json({ error: "End an open session before archiving it" }, 409);
  return c.json({ ok: true });
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/restore`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);
  const { data, error } = await db()
    .from("lab_sessions")
    .update({ archived_at: null })
    .eq("id", id)
    .eq("status", "closed")
    .select("id")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to restore the session" }, 500);
  if (!data) return c.json({ error: "Archived session not found" }, 404);
  return c.json({ ok: true });
});

app.delete(`${ROUTE_PREFIX}/admin/sessions/:id`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);
  const { data: deleted, error } = await db().rpc("delete_archived_lab_session", { p_session_id: id });
  if (error) return c.json({ error: "Failed to delete the session" }, 500);
  if (!deleted) return c.json({ error: "Only closed, archived sessions can be permanently deleted" }, 409);
  return c.json({ ok: true });
});

app.get(`${ROUTE_PREFIX}/admin/sessions/:id/report`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);

  const [sessionResult, tablesResult, requestsResult] = await Promise.all([
    db().from("lab_sessions").select("id, title, status, cooldown_seconds, created_at, requests_close_at, archived_at").eq("id", id).maybeSingle(),
    db().from("lab_tables").select("id, label, zone, sort_order").eq("session_id", id).order("sort_order", { ascending: true }),
    db().from("help_requests").select("id, table_id, problem, problem_category, status, created_at, instructor_arrived_at, completed_at, cancelled_at, cancelled_actor").eq("session_id", id).order("created_at", { ascending: true }),
  ]);
  if (sessionResult.error || tablesResult.error || requestsResult.error) {
    return c.json({ error: "Failed to build the session report" }, 500);
  }
  if (!sessionResult.data) return c.json({ error: "Session not found" }, 404);

  const requests = requestsResult.data ?? [];
  const tables = tablesResult.data ?? [];
  const waits = requests.flatMap((request) => {
    const seconds = waitSeconds(request);
    return seconds === null ? [] : [seconds];
  });
  const categoryCounts = [...PROBLEM_CATEGORIES].map((category) => ({
    category,
    count: requests.filter((request) => request.problem_category === category).length,
  })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count);

  const hourCounts = new Map<string, number>();
  const hourFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", hour12: false });
  for (const request of requests) {
    const hour = hourFormatter.format(new Date(request.created_at));
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  const peak = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  const tableStats = tables.map((table) => {
    const rows = requests.filter((request) => request.table_id === table.id);
    const tableWaits = rows.flatMap((request) => {
      const seconds = waitSeconds(request);
      return seconds === null ? [] : [seconds];
    });
    return {
      id: table.id,
      label: table.label,
      zone: table.zone,
      total_requests: rows.length,
      arrived: rows.filter((request) => request.status === "arrived" || request.status === "completed").length,
      student_cancelled: rows.filter((request) => request.status === "cancelled" && request.cancelled_actor === "student").length,
      admin_cancelled: rows.filter((request) => request.status === "cancelled" && request.cancelled_actor === "admin").length,
      average_wait_seconds: tableWaits.length ? Math.round(tableWaits.reduce((sum, value) => sum + value, 0) / tableWaits.length) : null,
    };
  });

  return c.json({
    session: sessionResult.data,
    summary: {
      total_requests: requests.length,
      arrived: requests.filter((request) => request.status === "arrived" || request.status === "completed").length,
      waiting: requests.filter((request) => request.status === "waiting").length,
      student_cancelled: requests.filter((request) => request.status === "cancelled" && request.cancelled_actor === "student").length,
      admin_cancelled: requests.filter((request) => request.status === "cancelled" && request.cancelled_actor === "admin").length,
      average_wait_seconds: waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length) : null,
      median_wait_seconds: median(waits),
      longest_wait_seconds: waits.length ? Math.max(...waits) : null,
      peak_hour: peak ? `${peak[0]}:00–${peak[0]}:59` : null,
      peak_hour_requests: peak?.[1] ?? 0,
      tables_never_requested: tableStats.filter((table) => table.total_requests === 0).length,
    },
    categories: categoryCounts,
    tables: tableStats,
    questions: requests.map((request) => ({
      id: request.id,
      table_label: tables.find((table) => table.id === request.table_id)?.label ?? "Unknown table",
      problem: request.problem,
      category: request.problem_category,
      status: request.status,
      created_at: request.created_at,
      instructor_arrived_at: arrivalTime(request),
      wait_seconds: waitSeconds(request),
    })),
  });
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/requests/schedule`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const delayMinutes = Number(body.delay_minutes);
  if (!Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > 360) {
    return c.json({ error: "Countdown must be between 1 and 360 minutes" }, 400);
  }

  const opensAt = new Date(Date.now() + delayMinutes * 60000).toISOString();
  const { data, error } = await db()
    .from("lab_sessions")
    .update({ requests_open_at: opensAt, requests_close_at: null })
    .eq("id", id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to schedule requests" }, 500);
  if (!data) return c.json({ error: "Open the lab session before starting a countdown" }, 409);
  return c.json({ ok: true, requests_open_at: opensAt });
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/requests/open`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);
  const { data, error } = await db()
    .from("lab_sessions")
    .update({ requests_open_at: new Date().toISOString(), requests_close_at: null })
    .eq("id", id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to open requests" }, 500);
  if (!data) return c.json({ error: "Open the lab session first" }, 409);
  return c.json({ ok: true });
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/requests/pause`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);
  const { data, error } = await db()
    .from("lab_sessions")
    .update({ requests_open_at: null, requests_close_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to pause requests" }, 500);
  if (!data) return c.json({ error: "Open the lab session first" }, 409);
  return c.json({ ok: true });
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/cooldown`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const cooldownSeconds = Number(body.cooldown_seconds);
  if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 21600) {
    return c.json({ error: "Cooldown must be between 0 and 360 minutes" }, 400);
  }

  const { data, error } = await db()
    .from("lab_sessions")
    .update({ cooldown_seconds: cooldownSeconds })
    .eq("id", id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to update the cooldown" }, 500);
  if (!data) return c.json({ error: "Session not found" }, 404);
  return c.json({ ok: true, cooldown_seconds: cooldownSeconds });
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/display-mode`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const mode = body.mode;
  if (mode !== "gradient" && mode !== "number") {
    return c.json({ error: "Display mode must be gradient or number" }, 400);
  }

  const { data, error } = await db()
    .from("lab_sessions")
    .update({ queue_priority_display: mode })
    .eq("id", id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to update the classroom display style" }, 500);
  if (!data) return c.json({ error: "Session not found" }, 404);
  await db().from("app_events").insert({ event_type: "session", session_id: id });
  return c.json({ ok: true, mode });
});

app.patch(`${ROUTE_PREFIX}/admin/requests/:id/cancel`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid request ID" }, 400);
  const now = new Date().toISOString();
  const { data: request, error } = await db()
    .from("help_requests")
    .update({ status: "cancelled", cancelled_at: now, cancelled_by: admin.userId, cancelled_actor: "admin" })
    .eq("id", id)
    .eq("status", "waiting")
    .select("id, session_id, table_id")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to cancel the request" }, 500);
  if (!request) return c.json({ error: "Waiting request not found" }, 404);
  const { error: cooldownError } = await db().from("lab_tables").update({ cooldown_reset_at: now }).eq("id", request.table_id);
  if (cooldownError) return c.json({ error: "Request cancelled but cooldown reset failed" }, 500);
  await db().from("app_events").insert({ event_type: "session", session_id: request.session_id });
  return c.json({ ok: true, cooldown_reset: true });
});

app.patch(`${ROUTE_PREFIX}/admin/tables/:id/cooldown/reset`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid table ID" }, 400);
  const { data: table, error } = await db()
    .from("lab_tables")
    .update({ cooldown_reset_at: new Date().toISOString() })
    .eq("id", id)
    .select("session_id")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to reset cooldown" }, 500);
  if (!table) return c.json({ error: "Table not found" }, 404);
  await db().from("app_events").insert({ event_type: "session", session_id: table.session_id });
  return c.json({ ok: true });
});

app.delete(`${ROUTE_PREFIX}/admin/tables/:id/assignment`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid table ID" }, 400);
  const { data: table, error: tableError } = await db().from("lab_tables").select("session_id").eq("id", id).maybeSingle();
  if (tableError) return c.json({ error: "Failed to load the table" }, 500);
  if (!table) return c.json({ error: "Table not found" }, 404);
  const { error } = await db().from("student_table_assignments").delete().eq("table_id", id).eq("session_id", table.session_id);
  if (error) return c.json({ error: "Failed to release the representative" }, 500);
  await db().from("app_events").insert({ event_type: "session", session_id: table.session_id });
  return c.json({ ok: true });
});

app.post(`${ROUTE_PREFIX}/admin/tables/:id/pin/regenerate`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  return c.json({ error: "Table PINs are permanent and cannot be regenerated" }, 410);
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/queue/clear`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);
  const now = new Date().toISOString();
  const { data: cancelled, error } = await db()
    .from("help_requests")
    .update({ status: "cancelled", cancelled_at: now, cancelled_by: admin.userId, cancelled_actor: "admin" })
    .eq("session_id", id)
    .eq("status", "waiting")
    .select("id");
  if (error) return c.json({ error: "Failed to clear the queue" }, 500);
  const { error: cooldownError } = await db().from("lab_tables").update({ cooldown_reset_at: now }).eq("session_id", id);
  if (cooldownError) return c.json({ error: "Queue cleared but cooldown reset failed" }, 500);
  await db().from("app_events").insert({ event_type: "session", session_id: id });
  return c.json({ ok: true, cancelled_count: cancelled?.length ?? 0 });
});

app.patch(`${ROUTE_PREFIX}/admin/sessions/:id/cooldowns/reset`, async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid session ID" }, 400);
  const { error } = await db().from("lab_tables").update({ cooldown_reset_at: new Date().toISOString() }).eq("session_id", id);
  if (error) return c.json({ error: "Failed to reset cooldowns" }, 500);
  await db().from("app_events").insert({ event_type: "session", session_id: id });
  return c.json({ ok: true });
});

// Public session context. A high-entropy browser token restores the claimed
// table without requiring or exposing a student identity.
app.get(`${ROUTE_PREFIX}/session/current`, async (c) => {
  const { data: session, error: sessionError } = await getOpenSession();
  if (sessionError) {
    console.error("GET /session/current session error:", sessionError.code);
    return c.json({ error: "Failed to load the lab session" }, 500);
  }
  if (!session) return c.json({ session: null, tables: [], assignment: null, usage: null });

  const tablesResult = await db()
    .from("lab_tables")
    .select("id, label, zone, sort_order, cooldown_reset_at")
    .eq("session_id", session.id)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  const assignmentResult = await anonymousAssignment(c, session.id);

  if (tablesResult.error || assignmentResult.error) {
    console.error("GET /session/current data error:", tablesResult.error?.code ?? assignmentResult.error?.code);
    return c.json({ error: "Failed to load session tables" }, 500);
  }

  const assignment = assignmentResult.assignment
    ? tablesResult.data?.find((table) => table.id === assignmentResult.assignment?.table_id) ?? null
    : null;

  let usage: { next_allowed_at: string | null } | null = null;
  if (assignment) {
    let latestQuery = db()
      .from("help_requests")
      .select("created_at, status, instructor_arrived_at, completed_at, cancelled_at")
      .eq("session_id", session.id)
      .eq("table_id", assignment.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (assignment.cooldown_reset_at) latestQuery = latestQuery.gt("created_at", assignment.cooldown_reset_at);

    const latestResult = await latestQuery.maybeSingle();
    if (latestResult.error) {
      console.error("GET /session/current usage error:", latestResult.error.code);
      return c.json({ error: "Failed to load table usage" }, 500);
    }
    const latestAnchor = latestResult.data ? cooldownStartTime(latestResult.data) : null;
    usage = {
      next_allowed_at: latestAnchor && session.cooldown_seconds > 0
        ? new Date(new Date(latestAnchor).getTime() + session.cooldown_seconds * 1000).toISOString()
        : null,
    };
  }

  const studentSession = {
    id: session.id,
    title: session.title,
    cooldown_seconds: session.cooldown_seconds,
    requests_status: requestWindowIsOpen(session) ? "open" : "closed",
  };
  const studentTables = (tablesResult.data ?? []).map(({ cooldown_reset_at: _reset, ...table }) => table);
  const studentAssignment = assignment
    ? { id: assignment.id, label: assignment.label, zone: assignment.zone, sort_order: assignment.sort_order }
    : null;
  return c.json({ session: studentSession, tables: studentTables, assignment: studentAssignment, usage });
});

app.post(`${ROUTE_PREFIX}/session/current/claim-table`, async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const tableId = typeof body.table_id === "string" ? body.table_id : "";
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!UUID_RE.test(tableId) || !/^\d{6}$/.test(pin)) {
    return c.json({ error: "Select a table and enter its 6-digit PIN" }, 400);
  }

  const { data: session, error: sessionError } = await getOpenSession();
  if (sessionError) return c.json({ error: "Failed to load the lab session" }, 500);
  if (!session) return c.json({ error: "No lab session is open" }, 409);

  const rawToken = crypto.randomUUID();
  const tokenHash = await sha256(rawToken);
  const { data: result, error } = await db().rpc("claim_lab_table_anonymous", {
    p_session_id: session.id,
    p_table_id: tableId,
    p_claim_token_hash: tokenHash,
    p_pin: pin,
  });
  if (error) {
    console.error("POST /claim-table db error:", error.code);
    return c.json({ error: "Failed to claim the table" }, 500);
  }
  const statusCode: Record<string, number> = {
    invalid_table_or_pin: 400,
    invalid_claim_token: 400,
    table_already_claimed: 409,
    session_not_open: 409,
  };
  if (result !== "ok") {
    return c.json({ error: result }, (statusCode[result] ?? 400) as 400 | 409);
  }
  return c.json({ ok: true, table_token: rawToken });
});

app.delete(`${ROUTE_PREFIX}/session/current/assignment`, async (c) => {
  const { data: session, error: sessionError } = await getOpenSession();
  if (sessionError) return c.json({ error: "Failed to load the lab session" }, 500);
  if (!session) return c.json({ error: "No lab session is open" }, 409);

  const assignmentResult = await anonymousAssignment(c, session.id);
  if (assignmentResult.error) return c.json({ error: "Failed to verify table access" }, 500);
  if (!assignmentResult.assignment) return c.json({ error: "Table access required" }, 401);

  const { data: waitingRequest, error: waitingError } = await db()
    .from("help_requests")
    .select("id")
    .eq("session_id", session.id)
    .eq("table_id", assignmentResult.assignment.table_id)
    .eq("status", "waiting")
    .limit(1)
    .maybeSingle();
  if (waitingError) return c.json({ error: "Failed to check the table queue" }, 500);
  if (waitingRequest) {
    return c.json({ error: "Finish or cancel the waiting request before releasing this table" }, 409);
  }

  const { data: released, error: releaseError } = await db()
    .from("student_table_assignments")
    .delete()
    .eq("id", assignmentResult.assignment.id)
    .eq("session_id", session.id)
    .select("id")
    .maybeSingle();
  if (releaseError) return c.json({ error: "Failed to release the table" }, 500);
  if (!released) return c.json({ error: "Table access required" }, 401);

  await db().from("app_events").insert({ event_type: "session", session_id: session.id });
  return c.json({ ok: true });
});

app.get(`${ROUTE_PREFIX}/queue`, async (c) => {
  const { data: session, error: sessionError } = await getOpenSession();
  if (sessionError) return c.json({ error: "Failed to load the lab session" }, 500);
  if (!session) return c.json([]);
  const { data, error } = await db()
    .from("help_requests")
    .select("id, session_id, table_id, group_number, zone, problem, problem_category, status, created_at, instructor_arrived_at, completed_at, table:lab_tables(label, zone)")
    .eq("session_id", session.id)
    .eq("status", "waiting")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("GET /queue db error:", error.code);
    return c.json({ error: "Failed to load queue" }, 500);
  }
  return c.json((data ?? []).map(requestToApi));
});

app.post(`${ROUTE_PREFIX}/queue`, async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const rawProblem = typeof body.problem === "string" ? body.problem.trim() : "";
  // Strip HTML tags to prevent XSS in admin panel and classroom display
  const problem = rawProblem.replace(/<[^>]*>/g, "");
  const requestedCategory = typeof body.problem_category === "string" ? body.problem_category : "other";
  const problemCategory = PROBLEM_CATEGORIES.has(requestedCategory) ? requestedCategory : "other";
  if (problem.length < 10 || problem.length > 300) {
    return c.json({ error: "Describe the problem using between 10 and 300 characters" }, 400);
  }

  const { data: session, error: sessionError } = await getOpenSession();
  if (sessionError) return c.json({ error: "Failed to load the lab session" }, 500);
  if (!session) return c.json({ error: "No lab session is open" }, 409);
  const now = Date.now();
  if (session.requests_open_at && now < new Date(session.requests_open_at).getTime()) {
    return c.json({ error: "Help requests are not open yet" }, 403);
  }
  if (session.requests_close_at && now > new Date(session.requests_close_at).getTime()) {
    return c.json({ error: "Help requests are closed" }, 403);
  }

  const assignmentResult = await anonymousAssignment(c, session.id);
  if (assignmentResult.error) return c.json({ error: "Failed to load your table" }, 500);
  if (!assignmentResult.assignment) return c.json({ error: "Enter your table PIN before requesting help" }, 401);

  const { data: table, error: tableError } = await db()
    .from("lab_tables")
    .select("id, label, zone, cooldown_reset_at")
    .eq("id", assignmentResult.assignment.table_id)
    .eq("session_id", session.id)
    .single();
  if (tableError || !table) return c.json({ error: "Your table is unavailable" }, 409);

  const numericTableLabel = Number(table.label);
  const groupNumber = Number.isInteger(numericTableLabel) && numericTableLabel > 0 && numericTableLabel <= 32767
    ? numericTableLabel
    : null;

  if (session.cooldown_seconds > 0) {
    let latestQuery = db()
      .from("help_requests")
      .select("created_at, status, instructor_arrived_at, completed_at, cancelled_at")
      .eq("session_id", session.id)
      .eq("table_id", table.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (table.cooldown_reset_at) latestQuery = latestQuery.gt("created_at", table.cooldown_reset_at);
    const { data: latest, error: latestError } = await latestQuery.maybeSingle();
    if (latestError) return c.json({ error: "Failed to check the cooldown" }, 500);
    if (latest) {
      const cooldownAnchor = cooldownStartTime(latest);
      const nextAllowed = new Date(cooldownAnchor).getTime() + session.cooldown_seconds * 1000;
      if (now < nextAllowed) {
        return c.json({ error: "This table is still in cooldown", retry_after_seconds: Math.ceil((nextAllowed - now) / 1000) }, 429);
      }
    }
  }

  const { data, error } = await db()
    .from("help_requests")
    .insert({
      session_id: session.id,
      table_id: table.id,
      requested_by: null,
      group_number: groupNumber,
      zone: table.zone,
      problem,
      problem_category: problemCategory,
    })
    .select("id, session_id, table_id, group_number, zone, problem, problem_category, status, created_at, instructor_arrived_at, completed_at")
    .single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "This table already has a waiting request" }, 409);
    const reference = checkConstraintReference(error);
    console.error("POST /queue db error:", reference);
    return c.json({ error: `Failed to submit request (reference: ${reference})` }, 500);
  }
  return c.json(requestToApi({ ...data, table: { label: table.label, zone: table.zone } }), 201);
});

async function tableForStudentAction(c: Context) {
  const { data: session, error: sessionError } = await getOpenSession();
  if (sessionError || !session) return { session: null, tableId: null, error: sessionError };
  const assignmentResult = await anonymousAssignment(c, session.id);
  return {
    session,
    tableId: assignmentResult.assignment?.table_id ?? null,
    error: assignmentResult.error,
  };
}

app.patch(`${ROUTE_PREFIX}/queue/:id/cancel`, async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid request ID" }, 400);
  const access = await tableForStudentAction(c);
  if (access.error) return c.json({ error: "Failed to verify table access" }, 500);
  if (!access.tableId) return c.json({ error: "Table access required" }, 401);
  const { data, error } = await db()
    .from("help_requests")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: null,
      cancelled_actor: "student",
    })
    .eq("id", id)
    .eq("table_id", access.tableId)
    .eq("status", "waiting")
    .select("id")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to cancel request" }, 500);
  if (!data) return c.json({ error: "Waiting request not found" }, 404);
  return c.json({ ok: true, cooldown_reset: false });
});

async function markInstructorArrived(c: Context) {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid request ID" }, 400);
  const access = await tableForStudentAction(c);
  if (access.error) return c.json({ error: "Failed to verify table access" }, 500);
  if (!access.tableId) return c.json({ error: "Table access required" }, 401);
  const { data, error } = await db()
    .from("help_requests")
    .update({ status: "arrived", instructor_arrived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("table_id", access.tableId)
    .eq("status", "waiting")
    .select("id")
    .single();
  if (error) {
    if (error.code === "PGRST116") return c.json({ error: "No waiting request found for this table" }, 404);
    console.error("PATCH /queue/:id/arrive db error:", error.code);
    return c.json({ error: "Failed to record instructor arrival" }, 500);
  }
  return c.json(data);
}

app.patch(`${ROUTE_PREFIX}/queue/:id/arrive`, markInstructorArrived);
// Compatibility for a browser tab left open on the previous interface.
app.patch(`${ROUTE_PREFIX}/queue/:id/complete`, markInstructorArrived);

Deno.serve(app.fetch);
