import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import {
  GatiColumnMap,
  type GatiAliasMap,
  type GatiOrderColumnEntry,
  type GatiWipColumnEntry,
} from "../models/gatiColumnMap";
import { IMPORT_FILE_TYPES, type ImportFileType } from "../types";

const router = Router();

function asFileType(x: unknown): ImportFileType | undefined {
  if (typeof x !== "string") return undefined;
  return (IMPORT_FILE_TYPES as readonly string[]).includes(x) ? (x as ImportFileType) : undefined;
}

function asAliases(x: unknown): GatiAliasMap | undefined {
  if (!x || typeof x !== "object") return undefined;
  const obj = x as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
      : [];
  return { diamond: arr(obj.diamond), metal: arr(obj.metal), finding: arr(obj.finding) };
}

function asOrderColumns(x: unknown): GatiOrderColumnEntry[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: GatiOrderColumnEntry[] = [];
  for (const raw of x) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const rawColumn = typeof obj.rawColumn === "string" ? obj.rawColumn.trim() : "";
    const fieldPath = typeof obj.fieldPath === "string" ? obj.fieldPath.trim() : "";
    if (rawColumn && fieldPath) {
      out.push({
        rawColumn,
        fieldPath,
        required: typeof obj.required === "boolean" ? obj.required : false,
      });
    }
  }
  return out;
}

function asWipColumns(x: unknown): GatiWipColumnEntry[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: GatiWipColumnEntry[] = [];
  for (const raw of x) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const rawColumn = typeof obj.rawColumn === "string" ? obj.rawColumn.trim() : "";
    const stageCode = typeof obj.stageCode === "string" ? obj.stageCode.trim().toUpperCase() : "";
    const cellCode = typeof obj.cellCode === "string" ? obj.cellCode.trim().toUpperCase() : "";
    // Only rawColumn is required — stageCode/cellCode may be blank for pending entries
    if (rawColumn) {
      out.push({ rawColumn, stageCode, cellCode });
    }
  }
  return out;
}

router.get("/column-maps/:fileType", requireAuth, requireRole("admin"), async (req, res) => {
  const fileType = asFileType(req.params.fileType);
  if (!fileType) return res.status(400).json({ error: "fileType must be 'orders' or 'wip'" });

  try {
    let map = await GatiColumnMap.findOne({ fileType, active: true });
    if (!map) {
      map = await GatiColumnMap.create({ fileType });
    }
    return res.status(200).json({ columnMap: map });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/column-maps/:fileType", requireAuth, requireRole("admin"), async (req, res) => {
  const fileType = asFileType(req.params.fileType);
  if (!fileType) return res.status(400).json({ error: "fileType must be 'orders' or 'wip'" });

  const body = req.body as Record<string, unknown>;

  try {
    let map = await GatiColumnMap.findOne({ fileType, active: true });
    if (!map) {
      map = new GatiColumnMap({ fileType });
    }

    const aliases = asAliases(body.aliases);
    if (aliases) map.aliases = aliases;

    const orderColumns = asOrderColumns(body.orderColumns);
    if (orderColumns) map.orderColumns = orderColumns;

    const wipColumns = asWipColumns(body.wipColumns);
    if (wipColumns) map.wipColumns = wipColumns;

    if (Number.isFinite(body.version)) map.version = Number(body.version);
    if (typeof body.active === "boolean") map.active = body.active;

    await map.save();
    return res.status(200).json({ columnMap: map });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
