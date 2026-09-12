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
  zone: string | null;
}

interface StudentRoomMapProps {
  tables: LabTable[];
  entries: HelpRequest[];
  activeTableId: string;
}

export function StudentRoomMap({ tables, entries, activeTableId }: StudentRoomMapProps) {
  const waitingTableIds = new Set(entries.map((entry) => entry.table_id));
  const activeZone = tables.find((table) => table.id === activeTableId)?.zone;
  const visibleTables = activeZone
    ? tables.filter((table) => table.zone === activeZone)
    : tables;

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-[#1e3a5f]">
          ตำแหน่งโต๊ะของคุณ
        </h3>
        {activeZone && (
          <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
            {activeZone}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-[#67ad66]" />
          Your table
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-[#c96da0]" />
          Waiting
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-white border border-gray-300" />
          Available
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {groupByZone(visibleTables).map(([zone, zoneTables], index) => {
          const style = zoneStyle(zone, index);
          return (
            <div
              key={zone}
              className="rounded-xl border p-2"
              style={{ backgroundColor: style.background, borderColor: style.border }}
            >
              <p className="mb-1.5 text-[11px] font-bold" style={{ color: style.accent }}>
                {zone}
              </p>
              <div className="grid grid-cols-5 gap-1.5">
                {zoneTables.map((table) => {
                  const isOwn = table.id === activeTableId;
                  const isWaiting = waitingTableIds.has(table.id);
                  return (
                    <div
                      key={table.id}
                      className={`flex min-h-8 items-center justify-center rounded-md border text-xs font-bold ${
                        isOwn
                          ? "border-green-700 bg-[#67ad66] text-white ring-2 ring-green-200"
                          : isWaiting
                            ? "border-pink-500 bg-[#c96da0] text-white"
                            : "border-white/70 bg-white/80 text-slate-600"
                      }`}
                    >
                      {table.label}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
