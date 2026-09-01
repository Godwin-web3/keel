import type { JournalRow } from "./types";

const KEY = "keel.journal.v1";
const LEGACY_KEY = "claimroll.journal.v1";

export function loadJournal(): JournalRow[] {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as JournalRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveJournal(rows: JournalRow[]): void {
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 200)));
}

export function appendJournal(row: Omit<JournalRow, "id" | "at"> & { id?: string; at?: string }): JournalRow[] {
  const next: JournalRow = {
    id: row.id ?? crypto.randomUUID(),
    at: row.at ?? new Date().toISOString(),
    ...row,
  };
  const rows = [next, ...loadJournal()];
  saveJournal(rows);
  return rows;
}
