import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, LayoutGrid, LogOut, Tablet } from "lucide-react";
import { sortTablesNumerically } from "../roomLayout";
import type { SessionContext } from "../shared";

interface TableClaimProps {
  context: SessionContext;
  edgeFunctionBase: string;
  accessToken: string;
  studentEmail: string;
  tableHeaders: (accessToken: string | null, includeJson?: boolean) => Record<string, string>;
  onClaimed: () => Promise<void>;
  onLogoutEmail: () => Promise<void>;
}

export function TableClaim({ context, edgeFunctionBase, accessToken, studentEmail, tableHeaders, onClaimed, onLogoutEmail }: TableClaimProps) {
  const [tableId, setTableId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectableTables = useMemo(() => sortTablesNumerically(context.tables), [context.tables]);

  const claim = async () => {
    if (!tableId || submitting) {
      setError("Select your table.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${edgeFunctionBase}/session/current/claim-table`, {
        method: "POST",
        headers: tableHeaders(accessToken),
        body: JSON.stringify({ table_id: tableId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages: Record<string, string> = {
          invalid_table_or_pin: "This table could not be confirmed. Please refresh and try again.",
          table_already_claimed: "Another account is already using this table.",
          user_already_assigned: "This email is already using another table. Log out of that table first.",
          session_not_open: "This lab session is not open.",
        };
        setError(messages[result.error] ?? result.error ?? "Could not confirm this table. Please try again.");
        return;
      }
      await onClaimed();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const logoutEmail = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await onLogoutEmail();
    setLoggingOut(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-pink-100 to-pink-200 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8">
        <a href="/" className="inline-flex items-center gap-1 text-sm text-gray-400 mb-5"><ArrowLeft className="w-4 h-4" />Back to home</a>
        <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4"><LayoutGrid className="w-7 h-7 text-[#67ad66]" /></div>
        <h1 className="text-xl text-center font-bold text-[#1e3a5f]">Choose your table</h1>
        <p className="text-sm text-center text-gray-500 mt-1">{context.session?.title}</p>
        <div className="mt-3 mb-5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-center"><p className="truncate text-xs font-medium text-gray-600">Signed in as {studentEmail}</p></div>
        <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-start gap-3"><Tablet className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" /><div><p className="text-sm font-bold text-blue-800">คำแนะนำก่อนเริ่มใช้งาน</p><p className="mt-1 text-sm leading-6 text-blue-700">เพื่อความสะดวกในการใช้งานระหว่างคาบ แนะนำให้เปิดเว็บไซต์นี้บน iPad ที่ใส่ซองพลาสติกป้องกันการปนเปื้อน</p></div></div>
        </div>
        <label className="text-xs text-gray-500 font-medium">Table</label>
        <select value={tableId} onChange={(event) => setTableId(event.target.value)} className="w-full mt-1 mb-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-green-300">
          <option value="">Select a table</option>
          {selectableTables.map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}
        </select>
        {error && <p className="text-xs text-red-500 mt-2 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
        <button onClick={claim} disabled={submitting} className="w-full mt-5 bg-[#c96da0] hover:bg-[#db97bd] disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors">{submitting ? "Checking…" : "Continue"}</button>
        <button onClick={logoutEmail} disabled={loggingOut || submitting} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50"><LogOut className="h-4 w-4" />{loggingOut ? "Signing out…" : "Log out from email"}</button>
        <p className="mt-3 text-center text-[11px] leading-4 text-gray-400">Your email and table-selection history are recorded for classroom administration.</p>
      </div>
    </div>
  );
}
