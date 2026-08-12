// deno-lint-ignore-file no-explicit-any

export function decide(penalty: any, signals: any[], set: Record<string, number>, superuser = false) {
  const hard = signals.some(s => s.kind === "attack" && s.confidence >= (set.attackBlockConfidence ?? 92));
  const blocked = !superuser && (penalty.blocked || hard);
  const delay = !superuser && !blocked ? penalty.delay : 0;
  const warn = penalty.warn || blocked || delay > 0 || hard;
  const prio = blocked || hard ? "error" : "warning";
  const reason = hard ? signals.find(s => s.kind === "attack")?.reason : penalty.reason;
  const score = Math.max(Number(penalty.score ?? 0), ...signals.map(s => Number(s.score ?? 0)));
  const confidence = Math.max(Number(penalty.confidence ?? 0), ...signals.map(s => Number(s.confidence ?? 0)));
  const severity = Math.min(100, Math.max(Number(penalty.severity ?? 0), ...signals.map(s => Number(s.severity ?? 0)), score));
  return { ...penalty, warn, prio, reason: reason ?? "request", confidence, severity, score, delay, blocked };
}
