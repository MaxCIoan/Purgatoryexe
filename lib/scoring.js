export const LEVEL_REQUIREMENTS = {
  level1: { minScore: 200000, maxScore: 50000000 },
  level2: { minScore: 10, maxScore: 10000 },
  level3: { minScore: 100000, maxScore: 100000 },
  boss: { minScore: 5000000, maxScore: 100000000 },
};

const MIN_RUN_MS = 20000;
const PERFECT_TIME_MS = 10 * 60 * 1000;
const SLOW_TIME_MS = 60 * 60 * 1000;

function numberFrom(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function timeFrom(value) {
  if (!value) return 0;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fail(reason, elapsedMs = 0, tampered = false) {
  return {
    finalScore: 0,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    tampered,
    tamperReason: reason,
  };
}

export function timeMultiplier(elapsedMs) {
  if (!elapsedMs || elapsedMs <= PERFECT_TIME_MS) return 1;
  if (elapsedMs >= SLOW_TIME_MS) return 0.1;
  const progress = (elapsedMs - PERFECT_TIME_MS) / (SLOW_TIME_MS - PERFECT_TIME_MS);
  return Math.max(0.1, 1 - progress * 0.9);
}

export function computeFinalScore({ startedMs, finishedMs, levels = {}, bossScore = 0 }) {
  const elapsedMs = Math.max(0, numberFrom(finishedMs) - numberFrom(startedMs));
  if (!startedMs || !finishedMs) return fail("run timestamps are missing", elapsedMs, true);
  if (elapsedMs < MIN_RUN_MS) return fail(`run completed in ${elapsedMs}ms, under the ${MIN_RUN_MS}ms floor`, elapsedMs, true);

  const level1 = levels.level1 || {};
  const level2 = levels.level2 || {};
  const level3 = levels.level3 || {};
  const boss = levels.boss || {};

  for (const [name, requirement] of Object.entries(LEVEL_REQUIREMENTS)) {
    const level = levels[name];
    if (!level?.completedAt) return fail(`${name} was never completed`, elapsedMs);
    const score = name === "boss" ? Math.max(numberFrom(level.score), numberFrom(bossScore)) : numberFrom(level.score);
    if (score < requirement.minScore) return fail(`${name} score ${score} below required ${requirement.minScore}`, elapsedMs);
    if (score > requirement.maxScore) return fail(`${name} score ${score} exceeds plausible cap ${requirement.maxScore}`, elapsedMs, true);
  }

  const completedTimes = [level1, level2, level3, boss].map(level => timeFrom(level.completedAt));
  if (completedTimes.some(time => !time)) return fail("one or more level completion timestamps are missing", elapsedMs, true);
  for (let index = 1; index < completedTimes.length; index += 1) {
    if (completedTimes[index] < completedTimes[index - 1]) return fail("level completion order is invalid", elapsedMs, true);
  }

  const socialCredit = numberFrom(level1.score);
  const mineralPower = Math.max(numberFrom(boss.score), numberFrom(bossScore));
  const flappyScore = numberFrom(level2.score);
  const storyScore = numberFrom(level3.score);
  const baseScore = socialCredit + mineralPower + flappyScore + storyScore;
  const finalScore = Math.max(0, Math.round(baseScore * timeMultiplier(elapsedMs)));

  return {
    finalScore,
    elapsedMs: Math.round(elapsedMs),
    tampered: false,
    tamperReason: null,
  };
}
