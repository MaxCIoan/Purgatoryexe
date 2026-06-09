import { query } from "../../db/index.ts";
import { computeFinalScore } from "../../lib/scoring.js";
import { cleanAgent, cleanScore, dateMs, json, readJson } from "./_shared.ts";

export const handler = async (event: { httpMethod: string; body?: string | null }) => {
  if (event.httpMethod !== "POST") return json(405, { error: "method not allowed" });

  try {
    const body = await readJson(event) as {
      runId?: string;
      token?: string;
      agent?: unknown;
      bossScore?: unknown;
    };
    if (!body.runId || !body.token) return json(400, { error: "run credentials are required" });

    const { rows } = await query(
      `select run_id as "runId", started_at as "startedAt", levels
       from runs
       where run_id = $1 and token = $2
       limit 1`,
      [body.runId, body.token],
    );
    const run = rows[0];

    if (!run) return json(404, { error: "run not found" });

    const finishedAt = new Date();
    const bossScore = cleanScore(body.bossScore);
    const previousLevels = parseLevels(run.levels);
    const previousBoss = typeof previousLevels.boss === "object" && previousLevels.boss
      ? previousLevels.boss as Record<string, unknown>
      : {};
    const levels = {
      ...previousLevels,
      boss: {
        ...previousBoss,
        score: Math.max(cleanScore(previousBoss.score), bossScore),
        completedAt: previousBoss.completedAt || finishedAt.toISOString(),
      },
    };

    const result = computeFinalScore({
      startedMs: dateMs(run.startedAt),
      finishedMs: finishedAt.getTime(),
      levels,
      bossScore,
    });

    await query(
      `update runs
       set agent = $1,
           finished_at = $2,
           status = 'completed',
           levels = $3::jsonb,
           final_score = $4,
           elapsed_ms = $5,
           tampered = $6,
           tamper_reason = $7
       where run_id = $8`,
      [
        cleanAgent(body.agent),
        finishedAt,
        JSON.stringify(levels),
        result.finalScore,
        result.elapsedMs,
        result.tampered,
        result.tamperReason,
        body.runId,
      ],
    );

    return json(200, result);
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "run finish failed" });
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
