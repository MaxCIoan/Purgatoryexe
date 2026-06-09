import { query } from "../../db/index.ts";
import { json } from "./_shared.ts";

export const handler = async (event: { httpMethod: string }) => {
  if (event.httpMethod !== "GET") return json(405, { error: "method not allowed" });

  try {
    const { rows: leaders } = await query(
      `select agent,
              final_score as "finalScore",
              elapsed_ms as "elapsedMs",
              finished_at as "finishedAt",
              tampered,
              tamper_reason as "tamperReason"
       from runs
       where status = 'completed'
       order by final_score desc, elapsed_ms asc, finished_at asc
       limit 20`,
    );

    return json(200, { leaders });
  } catch (error) {
    console.error("leaderboard failed", error);
    return json(500, { error: error instanceof Error ? error.message : "leaderboard failed" });
  }
};
