import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { ProductionCalendar, type ProductionShift } from "../models/productionCalendar";

const router = Router();

function asShifts(x: unknown): ProductionShift[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: ProductionShift[] = [];
  for (const raw of x) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    const startTime = typeof obj.startTime === "string" ? obj.startTime.trim() : "";
    const endTime = typeof obj.endTime === "string" ? obj.endTime.trim() : "";
    if (name && startTime && endTime) {
      out.push({ name, startTime, endTime });
    }
  }
  return out;
}

function asNumberArray(x: unknown): number[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x.filter((v): v is number => Number.isFinite(v));
}

function asStringArray(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

router.get("/calendar", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const calendar =
      (await ProductionCalendar.findOne({ key: "default" })) ??
      (await ProductionCalendar.create({ key: "default" }));
    return res.status(200).json({ calendar });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/calendar", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as Record<string, unknown>;

  try {
    const calendar =
      (await ProductionCalendar.findOne({ key: "default" })) ??
      new ProductionCalendar({ key: "default" });

    const shifts = asShifts(body.shifts);
    if (shifts) calendar.shifts = shifts;

    const weekendDays = asNumberArray(body.weekendDays);
    if (weekendDays) calendar.weekendDays = weekendDays;

    const holidayDates = asStringArray(body.holidayDates);
    if (holidayDates) calendar.holidayDates = holidayDates;

    if (Number.isFinite(body.defaultDailyHours)) {
      calendar.defaultDailyHours = Number(body.defaultDailyHours);
    }

    if (typeof body.active === "boolean") calendar.active = body.active;

    await calendar.save();
    return res.status(200).json({ calendar });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
