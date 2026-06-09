import { query } from "../../db/index.ts";
import { cleanAgent, json, readJson } from "./_shared.ts";

export const handler = async (event: { httpMethod: string; body?: string | null }) => {
  if (event.httpMethod !== "POST") return json(405, { error: "method not allowed" });

  try {
    const body = await readJson(event);
    const runId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const agent = cleanAgent((body as { agent?: unknown }).agent);

    const { rows } = await query(
      `insert into runs (run_id, token, agent, levels)
       values ($1, $2, $3, '{}'::jsonb)
       returning run_id as "runId", token, agent, started_at as "startedAt"`,
      [runId, token, agent],
    );

    return json(200, rows[0]);
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "run start failed" });
  }
};
