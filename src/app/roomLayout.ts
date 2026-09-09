export const ZONE_ORDER = ["Zone A", "Zone B", "Zone C", "Zone D"] as const;

export const ZONE_STYLES: Record<string, { background: string; border: string; accent: string; soft: string }> = {
  "Zone A": { background: "#fff8d8", border: "#f3d35b", accent: "#b98500", soft: "#fffdf2" },
  "Zone B": { background: "#e9f1ff", border: "#76a9fa", accent: "#2f6fcb", soft: "#f5f8ff" },
  "Zone C": { background: "#e7f8ec", border: "#77cf8b", accent: "#32854a", soft: "#f4fcf6" },
  "Zone D": { background: "#f5ebff", border: "#bd91ec", accent: "#7b4ab0", soft: "#fbf7ff" },
};

const GROSS_2569_ROWS = [
  [1, 2, 3, 4, 5, 6],
  [12, 11, 10, 9, 8, 7],
  [13, 14, 15, 16, 17, 18],
  [24, 23, 22, 21, 20, 19],
  [25, 26, 27, 28, 29, 30],
  [35, 34, 33, 32, 31],
  [36, 37, 38, 39, 40],
] as const;

export const GROSS_2569_TABLES = GROSS_2569_ROWS.flat().map((tableNumber) => ({
  label: String(tableNumber),
  zone: tableNumber <= 12 ? "Zone A" : tableNumber <= 24 ? "Zone B" : tableNumber <= 35 ? "Zone C" : "Zone D",
}));

export const ROOM_LAYOUT_PRESETS = {
  "2569": {
    id: "2569",
    name: "Academic year 2569",
    description: "40 tables · 4 zones",
    tables: GROSS_2569_TABLES,
  },
} as const;

export type RoomLayoutId = keyof typeof ROOM_LAYOUT_PRESETS;

export function sortTablesNumerically<T extends { label: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftNumber = Number(left.label);
    const rightNumber = Number(right.label);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function groupByZone<T extends { zone: string | null }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const zone = item.zone?.trim() || "Other tables";
    groups.set(zone, [...(groups.get(zone) ?? []), item]);
  }

  return [...groups.entries()].sort(([left], [right]) => {
    const leftIndex = ZONE_ORDER.indexOf(left as (typeof ZONE_ORDER)[number]);
    const rightIndex = ZONE_ORDER.indexOf(right as (typeof ZONE_ORDER)[number]);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

export function zoneStyle(zone: string, fallbackIndex = 0) {
  if (ZONE_STYLES[zone]) return ZONE_STYLES[zone];
  const fallbacks = Object.values(ZONE_STYLES);
  return fallbacks[fallbackIndex % fallbacks.length];
}
