export function json(statusCode: number, data: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(data),
  };
}

export async function readJson(event: { body?: string | null }) {
  if (!event.body) return {};
  return JSON.parse(event.body);
}

export function cleanAgent(value: unknown) {
  const agent = String(value || "AGENT-GUEST")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 40);
  return agent || "AGENT-GUEST";
}

export function cleanScore(value: unknown) {
  const score = Math.floor(Number(value) || 0);
  return Number.isFinite(score) && score > 0 ? score : 0;
}

export function dateMs(value: unknown) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
