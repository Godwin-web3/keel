import type { JournalRow } from "./types";

const KEY = "keel.journal.v1";
const LEGACY_KEY = "claimroll.journal.v1";

function migrateKind(kind: string): JournalRow["kind"] {
  // Older builds logged commit/reveal as seal/unseal; map them so KIND_LABEL
  // and filters don't go blank on leftover localStorage rows.
  if (kind === "seal") return "commit";
  if (kind === "unseal") return "reveal";
  return kind as JournalRow["kind"];
}

export function loadJournal(): JournalRow[] {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<JournalRow & { kind: string }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => ({ ...row, kind: migrateKind(row.kind) }));
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
