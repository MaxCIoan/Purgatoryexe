import { getDatabase } from "@netlify/database";

export function query(text: string, params: unknown[] = []) {
  const connectionString = process.env.NETLIFY_DB_URL || process.env.DATABASE_URL;
  const database = connectionString ? getDatabase({ connectionString }) : getDatabase();
  return database.pool.query(text, params);
}
