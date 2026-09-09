import { Users } from "lucide-react";
import { groupByZone, zoneStyle } from "../roomLayout";

interface LabTable {
  id: string;
  label: string;
  zone: string | null;
  sort_order: number;
}

interface HelpRequest {
  id: string;
  table_id: string;
  table_label: string;
  zone: string | null;
  problem: string;
}

interface ZoneQueueTablesProps {
  entries: HelpRequest[];
  tables: LabTable[];
  activeTableId: string;
  isLive: boolean;
}

export function ZoneQueueTables({ entries, tables, activeTableId, isLive }: ZoneQueueTablesProps) {
  const zones = groupByZone(tables).map(([zone]) => zone);
  return (
    <div className="bg-white rounded-3xl shadow-2xl p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-[#67ad66]" />
          <h3 className="text-[#1e3a5f] font-semibold">Queues by zone</h3>
        </div>
        <span className="text-xs text-gray-400 flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            {isLive && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isLive ? "bg-green-500" : "bg-amber-400"
              }`}
            />
          </span>
          {isLive ? "Live" : "Connecting"} · {entries.length} waiting
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto">
        {zones.map((zone, zoneIndex) => {
          const style = zoneStyle(zone, zoneIndex);
          const zoneEntries = entries.filter(
            (entry) => (entry.zone?.trim() || "Other tables") === zone
          );
          const totalRows = Math.max(3, zoneEntries.length);
          return (
            <div
              key={zone}
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: style.border }}
            >
              <div
                className="flex items-center px-3 py-2"
                style={{ backgroundColor: style.background, color: style.accent }}
              >
                <strong className="text-sm">{zone}</strong>
                <span className="ml-auto text-[10px] font-semibold">
                  {zoneEntries.length} waiting
                </span>
              </div>
              <table className="w-full table-fixed text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="w-9 px-2 py-1.5 text-center">Q</th>
                    <th className="w-14 px-2 py-1.5 text-left">Table</th>
                    <th className="px-2 py-1.5 text-left">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: totalRows }, (_, index) => {
                    const entry = zoneEntries[index];
                    const isActive = entry?.table_id === activeTableId;
                    return (
                      <tr
                        key={entry?.id ?? `${zone}-empty-${index}`}
                        className={`border-t border-slate-100 ${
                          isActive ? "bg-green-100" : "bg-white"
                        }`}
                      >
                        <td className="px-2 py-2 text-center text-gray-400">
                          {entry ? index + 1 : ""}
                        </td>
                        <td className="px-2 py-2 font-bold text-[#1e3a5f]">
                          {entry?.table_label ?? ""}
                        </td>
                        <td
                          className="truncate px-2 py-2 text-gray-500"
                          title={entry?.problem}
                        >
                          {entry?.problem ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
