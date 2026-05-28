import { recomputeBaselines } from "../production/capacityService";
import { runAlertRules } from "../production/alertEngine";

const MIN_MS = 60_000;

/**
 * Periodic in-process schedulers for the production-planner module.
 *
 * Two jobs:
 *   - `recomputeBaselines`  → every 6 hours (default)
 *   - `runAlertRules`       → every 15 minutes (default)
 *
 * Both can be tuned by env:
 *   PRODUCTION_PLANNER_BASELINE_INTERVAL_MIN  (default 360 = 6h)
 *   PRODUCTION_PLANNER_ALERT_INTERVAL_MIN     (default 15)
 *
 * Disable entirely with `PRODUCTION_PLANNER_DISABLE_SCHEDULERS=true` (useful
 * in tests / one-off scripts / CI).
 *
 * Failures inside a tick are logged and swallowed — a single bad run must
 * never crash the schedulers or the host process.
 */
export interface SchedulerHandle {
  baselineTimer: NodeJS.Timeout | null;
  alertTimer: NodeJS.Timeout | null;
  stop: () => void;
}

let active: SchedulerHandle | null = null;

export function startSchedulers(): SchedulerHandle | null {
  if (process.env.PRODUCTION_PLANNER_DISABLE_SCHEDULERS === "true") {
    // eslint-disable-next-line no-console
    console.log("[production-planner] schedulers disabled via env");
    return null;
  }
  if (active) return active;

  const baselineIntervalMin = parsePositiveInt(
    process.env.PRODUCTION_PLANNER_BASELINE_INTERVAL_MIN,
    360
  );
  const alertIntervalMin = parsePositiveInt(
    process.env.PRODUCTION_PLANNER_ALERT_INTERVAL_MIN,
    15
  );

  const baselineTimer = setInterval(() => {
    void runWithLog("recomputeBaselines", async () => {
      const summaries = await recomputeBaselines();
      return { stages: summaries.length };
    });
  }, baselineIntervalMin * MIN_MS);

  const alertTimer = setInterval(() => {
    void runWithLog("runAlertRules", async () => {
      const summary = await runAlertRules();
      return summary;
    });
  }, alertIntervalMin * MIN_MS);

  // Don't keep the Node event loop alive purely on these timers — if the
  // server is shutting down (or imported by a CLI), they should not block exit.
  baselineTimer.unref?.();
  alertTimer.unref?.();

  // Fire one delayed initial run so the system has fresh data minutes after
  // boot rather than waiting a full interval.
  setTimeout(() => {
    void runWithLog("recomputeBaselines (startup)", async () => {
      const summaries = await recomputeBaselines();
      return { stages: summaries.length };
    });
  }, 30 * 1000).unref?.();

  setTimeout(() => {
    void runWithLog("runAlertRules (startup)", async () => {
      const summary = await runAlertRules();
      return summary;
    });
  }, 60 * 1000).unref?.();

  // eslint-disable-next-line no-console
  console.log(
    `[production-planner] schedulers running: baselines every ${baselineIntervalMin}m, alerts every ${alertIntervalMin}m`
  );

  active = {
    baselineTimer,
    alertTimer,
    stop: () => {
      if (baselineTimer) clearInterval(baselineTimer);
      if (alertTimer) clearInterval(alertTimer);
      active = null;
    },
  };
  return active;
}

export function stopSchedulers(): void {
  active?.stop();
}

async function runWithLog<T>(label: string, fn: () => Promise<T>): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(`[production-planner] ${label} ok in ${ms}ms`, result ?? "");
  } catch (err) {
    const ms = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[production-planner] ${label} FAILED after ${ms}ms:`, message);
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Exposed for unit tests / monitoring. */
export function getSchedulerStatus(): {
  running: boolean;
  baselineIntervalMin: number;
  alertIntervalMin: number;
  disabled: boolean;
} {
  return {
    running: active !== null,
    baselineIntervalMin: parsePositiveInt(
      process.env.PRODUCTION_PLANNER_BASELINE_INTERVAL_MIN,
      360
    ),
    alertIntervalMin: parsePositiveInt(
      process.env.PRODUCTION_PLANNER_ALERT_INTERVAL_MIN,
      15
    ),
    disabled: process.env.PRODUCTION_PLANNER_DISABLE_SCHEDULERS === "true",
  };
}

