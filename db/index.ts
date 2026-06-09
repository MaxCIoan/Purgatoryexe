import { getDatabase } from "@netlify/database";

const database = getDatabase();

export function query(text: string, params: unknown[] = []) {
  return database.pool.query(text, params);
}
