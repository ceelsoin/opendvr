import { randomUUID } from "node:crypto";
import { db } from "./client.js";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

function toUser(row: UserRow): User {
  return { id: row.id, username: row.username, passwordHash: row.password_hash, createdAt: row.created_at };
}

export function countUsers(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

export function getUserByUsername(username: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function getUserById(id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function createUser(username: string, passwordHash: string): User {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run(id, username, passwordHash);
  const user = getUserByUsername(username);
  if (!user) {
    throw new Error("Failed to load user after creation");
  }
  return user;
}

/** Used by the Maintenance page's "change password" action - see api/routes/maintenance.routes.ts. */
export function updateUserPassword(id: string, passwordHash: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
}
