CREATE TABLE IF NOT EXISTS "runs" (
  "id" serial PRIMARY KEY,
  "run_id" text NOT NULL UNIQUE,
  "token" text NOT NULL,
  "agent" text DEFAULT 'AGENT-GUEST' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "finished_at" timestamp,
  "status" text DEFAULT 'active' NOT NULL,
  "levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "final_score" integer DEFAULT 0 NOT NULL,
  "elapsed_ms" integer DEFAULT 0 NOT NULL,
  "tampered" boolean DEFAULT false NOT NULL,
  "tamper_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "runs_leaderboard_idx" ON "runs" ("status", "final_score", "elapsed_ms");
