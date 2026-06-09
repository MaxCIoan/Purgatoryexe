import { query } from "../../db/index.ts";
import { cleanAgent, cleanScore, json, readJson } from "./_shared.ts";

const allowedLevels = new Set(["level1", "level2", "level3"]);

export const handler = async (event: { httpMethod: string; body?: string | null }) => {
  if (event.httpMethod !== "POST") return json(405, { error: "method not allowed" });

  try {
    const body = await readJson(event) as {
      runId?: string;
      token?: string;
      agent?: unknown;
      level?: string;
      score?: unknown;
    };
    if (!body.runId || !body.token) return json(400, { error: "run credentials are required" });
    if (!body.level || !allowedLevels.has(body.level)) return json(400, { error: "invalid level" });

    const { rows } = await query(
      `select run_id as "runId", status, levels
       from runs
       where run_id = $1 and token = $2
       limit 1`,
      [body.runId, body.token],
    );
    const run = rows[0];

    if (!run) return json(404, { error: "run not found" });
    if (run.status !== "active") return json(409, { error: "run already finished" });

    const previousLevels = parseLevels(run.levels);
    const previousLevel = typeof previousLevels[body.level] === "object" && previousLevels[body.level]
      ? previousLevels[body.level] as Record<string, unknown>
      : {};
    const levels = {
      ...previousLevels,
      [body.level]: {
        ...previousLevel,
        score: Math.max(cleanScore(previousLevel.score), cleanScore(body.score)),
        completedAt: previousLevel.completedAt || new Date().toISOString(),
      },
    };

    await query(
      `update runs
       set agent = $1, levels = $2::jsonb
       where run_id = $3`,
      [cleanAgent(body.agent), JSON.stringify(levels), body.runId],
    );

    return json(200, { ok: true, levels });
  } catch (error) {
    console.error("run-level failed", error);
    return json(500, { error: error instanceof Error ? error.message : "level update failed" });
  }
};

function parseLevels(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
