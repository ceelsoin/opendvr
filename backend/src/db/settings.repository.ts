import { db } from "./client.js";

/** Generic key/value settings store, currently used for runtime-editable notification channel config. */
export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

/** Setting `value` to null clears/removes the override, falling back to the env var default again. */
export function setSetting(key: string, value: string | null): void {
  if (value === null) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ key, value });
}
