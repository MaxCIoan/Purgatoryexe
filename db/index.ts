import { getDatabase } from "@netlify/database";

export function query(text: string, params: unknown[] = []) {
  const database = getDatabase();
  return database.pool.query(text, params);
}
