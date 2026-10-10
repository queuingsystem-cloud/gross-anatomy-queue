export interface SessionReport {
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
  tables: Array<{
    id: string;
    label: string;
    zone: string | null;
    total_requests: number;
    arrived: number;
    student_cancelled: number;
    admin_cancelled: number;
    average_wait_seconds: number | null;
  }>;
  questions: Array<{
    id: string;
    table_label: string;
    problem: string;
    category: string;
    status: string;
    created_at: string;
    instructor_arrived_at: string | null;
    wait_seconds: number | null;
  }>;
}

interface ReportSession {
  title: string;
  status: "draft" | "open" | "closed";
  created_at: string;
  archived_at: string | null;
  cooldown_seconds: number;
  tables: Array<{ label: string }>;
}

export const CATEGORY_LABELS: Record<string, string> = {
  identify_structure: "Identify a structure",
  dissection_technique: "Dissection technique",
  anatomical_relationship: "Anatomical relationships",
  clarify_instructions: "Clarify instructions",
  specimen_issue: "Specimen problem",
  other: "Other",
};

export function durationLabel(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function pdfDurationLabel(seconds: number | null) {
  return seconds === null ? "-" : durationLabel(seconds);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readableStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function numericTableSort<T extends { label: string }>(items: T[]) {
  return [...items].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
}

function safeFilePart(value: string) {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return cleaned || "lab-session";
}

export function buildSessionReportHtml(session: ReportSession, report: SessionReport) {
  const generatedAt = new Date();
  const sessionState = session.archived_at ? "Archived" : readableStatus(session.status);
  const sortedTables = numericTableSort(report.tables);

  const categoryRows = report.categories.length
    ? report.categories.map((category) => `
      <tr>
        <td>${escapeHtml(CATEGORY_LABELS[category.category] ?? readableStatus(category.category))}</td>
        <td class="number">${category.count}</td>
      </tr>`).join("")
    : '<tr><td colspan="2" class="empty">No categorized requests</td></tr>';

  const tableRows = sortedTables.length
    ? sortedTables.map((table) => `
      <tr>
        <td class="strong">${escapeHtml(table.label)}</td>
        <td>${escapeHtml(table.zone ?? "-")}</td>
        <td class="number">${table.total_requests}</td>
        <td class="number">${table.arrived}</td>
        <td class="number">${table.student_cancelled}</td>
        <td class="number">${table.admin_cancelled}</td>
        <td class="number">${escapeHtml(pdfDurationLabel(table.average_wait_seconds))}</td>
      </tr>`).join("")
    : '<tr><td colspan="7" class="empty">No table data</td></tr>';

  const questionRows = report.questions.length
    ? report.questions.map((question, index) => `
      <tr class="question-row">
        <td class="number muted">${index + 1}</td>
        <td class="strong">${escapeHtml(question.table_label)}</td>
        <td>${escapeHtml(CATEGORY_LABELS[question.category] ?? readableStatus(question.category || "other"))}</td>
        <td class="problem">${escapeHtml(question.problem || "-")}</td>
        <td>${escapeHtml(readableStatus(question.status))}</td>
        <td>${escapeHtml(formatDateTime(question.created_at))}</td>
        <td class="number">${escapeHtml(pdfDurationLabel(question.wait_seconds))}</td>
      </tr>`).join("")
    : '<tr><td colspan="7" class="empty">No questions were recorded</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Gross-Anatomy-Queue-${escapeHtml(safeFilePart(session.title))}-Report</title>
  <style>
    @page { size: A4 portrait; margin: 13mm 12mm 15mm; }
    * { box-sizing: border-box; }
    html { background: #eef2f7; }
    body {
      margin: 0;
      color: #26364a;
      background: #eef2f7;
      font-family: -apple-system, BlinkMacSystemFont, "Noto Sans Thai", "Thonburi", "Tahoma", "Arial", sans-serif;
      font-size: 10pt;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 18px auto;
      padding: 13mm 12mm 15mm;
      background: white;
      box-shadow: 0 8px 30px rgba(30, 58, 95, 0.12);
    }
    .screen-toolbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 16px;
      color: white;
      background: #1e3a5f;
      font-size: 14px;
    }
    .screen-toolbar button {
      border: 0;
      border-radius: 8px;
      padding: 8px 14px;
      color: #1e3a5f;
      background: white;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .report-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 13px;
      border-bottom: 3px solid #67ad66;
    }
    .eyebrow { margin: 0 0 3px; color: #67ad66; font-size: 8pt; font-weight: 800; letter-spacing: 1.8px; text-transform: uppercase; }
    h1 { margin: 0; color: #1e3a5f; font-size: 22pt; line-height: 1.12; }
    .subtitle { margin: 5px 0 0; color: #6f7e91; }
    .status { display: inline-block; border-radius: 99px; padding: 5px 10px; color: #29613a; background: #e5f6e7; font-size: 8.5pt; font-weight: 800; text-transform: uppercase; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 13px; }
    .meta-card { border: 1px solid #dfe7ef; border-radius: 8px; padding: 8px 9px; background: #f8fafc; }
    .meta-label { margin: 0; color: #8491a3; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .5px; }
    .meta-value { margin: 2px 0 0; color: #273a53; font-size: 9pt; font-weight: 700; }
    .section { margin-top: 16px; }
    .section-title { margin: 0 0 7px; color: #1e3a5f; font-size: 12.5pt; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
    .summary-card { min-height: 56px; border: 1px solid #dfe7ef; border-radius: 8px; padding: 8px; text-align: center; background: #fff; }
    .summary-card.primary { background: #edf5ff; border-color: #cadff5; }
    .summary-card.success { background: #edf9ef; border-color: #cfe9d2; }
    .metric { margin: 0; color: #1e3a5f; font-size: 17pt; font-weight: 800; line-height: 1.1; }
    .metric-label { margin: 4px 0 0; color: #77869a; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .35px; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 7px; }
    .detail { display: flex; justify-content: space-between; gap: 12px; border-radius: 7px; padding: 7px 9px; background: #f4f7fa; }
    .detail span { color: #6f7e91; }
    .detail strong { color: #26364a; text-align: right; }
    .two-columns { display: grid; grid-template-columns: .85fr 1.15fr; gap: 12px; align-items: start; }
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    thead { display: table-header-group; break-inside: avoid; page-break-inside: avoid; }
    th { padding: 6px 6px; color: #fff; background: #1e3a5f; font-size: 7.5pt; text-align: left; text-transform: uppercase; letter-spacing: .25px; }
    th:first-child { border-radius: 6px 0 0 0; }
    th:last-child { border-radius: 0 6px 0 0; }
    td { padding: 5px 6px; border-bottom: 1px solid #e3e9ef; vertical-align: top; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .question-row { break-inside: auto; page-break-inside: auto; }
    .question-row td { padding-top: 6px; padding-bottom: 6px; }
    .question-table thead { display: table-row-group; }
    .number { text-align: right; font-variant-numeric: tabular-nums; }
    .strong { font-weight: 800; color: #1e3a5f; }
    .muted { color: #8794a5; }
    .problem { min-width: 42mm; white-space: pre-wrap; overflow-wrap: anywhere; }
    .empty { padding: 13px; color: #8794a5; text-align: center; }
    .report-footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #dfe7ef; color: #8794a5; font-size: 7.5pt; }
    @media print {
      html, body { background: white; }
      .screen-toolbar { display: none !important; }
      .print-sheet { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; }
      .section { break-inside: auto; }
      .summary-section, .category-section { break-inside: avoid; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="screen-toolbar">
    <span>The report is ready. In the print window, choose <strong>Save as PDF</strong>.</span>
    <button type="button" onclick="window.print()">Print / Save PDF</button>
  </div>
  <main class="print-sheet">
    <header class="report-header">
      <div>
        <p class="eyebrow">Gross Anatomy Help Queue</p>
        <h1>${escapeHtml(session.title)}</h1>
        <p class="subtitle">Session statistics report</p>
      </div>
      <span class="status">${escapeHtml(sessionState)}</span>
    </header>

    <div class="meta-grid">
      <div class="meta-card"><p class="meta-label">Session created</p><p class="meta-value">${escapeHtml(formatDateTime(session.created_at))}</p></div>
      <div class="meta-card"><p class="meta-label">Tables</p><p class="meta-value">${session.tables.length}</p></div>
      <div class="meta-card"><p class="meta-label">Cooldown</p><p class="meta-value">${escapeHtml(pdfDurationLabel(session.cooldown_seconds))}</p></div>
      <div class="meta-card"><p class="meta-label">Report generated</p><p class="meta-value">${escapeHtml(formatDateTime(generatedAt.toISOString()))}</p></div>
    </div>

    <section class="section summary-section">
      <h2 class="section-title">Summary</h2>
      <div class="summary-grid">
        <div class="summary-card primary"><p class="metric">${report.summary.total_requests}</p><p class="metric-label">Total requests</p></div>
        <div class="summary-card success"><p class="metric">${report.summary.arrived}</p><p class="metric-label">Instructor arrived</p></div>
        <div class="summary-card"><p class="metric">${escapeHtml(pdfDurationLabel(report.summary.median_wait_seconds))}</p><p class="metric-label">Median wait</p></div>
        <div class="summary-card"><p class="metric">${escapeHtml(pdfDurationLabel(report.summary.longest_wait_seconds))}</p><p class="metric-label">Longest wait</p></div>
      </div>
      <div class="detail-grid">
        <div class="detail"><span>Average wait</span><strong>${escapeHtml(pdfDurationLabel(report.summary.average_wait_seconds))}</strong></div>
        <div class="detail"><span>Still waiting at close</span><strong>${report.summary.waiting}</strong></div>
        <div class="detail"><span>Student cancellations</span><strong>${report.summary.student_cancelled}</strong></div>
        <div class="detail"><span>Admin cancellations</span><strong>${report.summary.admin_cancelled}</strong></div>
        <div class="detail"><span>Peak request period</span><strong>${escapeHtml(report.summary.peak_hour ?? "-")}${report.summary.peak_hour ? ` (${report.summary.peak_hour_requests})` : ""}</strong></div>
        <div class="detail"><span>Tables with no requests</span><strong>${report.summary.tables_never_requested}</strong></div>
      </div>
    </section>

    <section class="section category-section">
      <div class="two-columns">
        <div>
          <h2 class="section-title">Question categories</h2>
          <table>
            <thead><tr><th>Category</th><th class="number">Requests</th></tr></thead>
            <tbody>${categoryRows}</tbody>
          </table>
        </div>
        <div>
          <h2 class="section-title">Report notes</h2>
          <div class="detail"><span>Completed requests</span><strong>${report.summary.arrived} of ${report.summary.total_requests}</strong></div>
          <div class="detail" style="margin-top: 7px"><span>Completion rate</span><strong>${report.summary.total_requests ? Math.round((report.summary.arrived / report.summary.total_requests) * 100) : 0}%</strong></div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Requests by table</h2>
      <table>
        <thead><tr><th>Table</th><th>Zone</th><th class="number">Total</th><th class="number">Arrived</th><th class="number">Student cancel</th><th class="number">Admin cancel</th><th class="number">Avg wait</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </section>

    <section class="section question-section">
      <h2 class="section-title">Question log (${report.questions.length})</h2>
      <table class="question-table">
        <thead><tr><th class="number">#</th><th>Table</th><th>Category</th><th>Question / problem</th><th>Status</th><th>Requested at</th><th class="number">Wait</th></tr></thead>
        <tbody>${questionRows}</tbody>
      </table>
    </section>

    <footer class="report-footer">Generated from Gross Anatomy Help Queue. Session data remains stored in Supabase unless the session is permanently deleted.</footer>
  </main>
</body>
</html>`;
}

export function exportSessionReportPdf(session: ReportSession, report: SessionReport) {
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) return false;

  reportWindow.opener = null;
  reportWindow.document.open();
  reportWindow.document.write(buildSessionReportHtml(session, report));
  reportWindow.document.close();

  const openPrintDialog = () => {
    reportWindow.focus();
    reportWindow.print();
  };

  if (reportWindow.document.fonts) {
    void reportWindow.document.fonts.ready.then(() => window.setTimeout(openPrintDialog, 250));
  } else {
    window.setTimeout(openPrintDialog, 500);
  }
  return true;
}
