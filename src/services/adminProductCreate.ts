import mongoose from "mongoose";
import * as XLSX from "xlsx";

import { Category } from "../models/Category";
import { Product } from "../models/Product";
import { Subcategory, type FilterField } from "../models/Subcategory";
import { SubcategoryProfile } from "../models/SubcategoryProfile";
import type { Diamond, MetalWeights, ProductDocument, ProductFilterValue } from "../models/Product";

function asTrimmedString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t.length ? t : undefined;
}

function normalizeDisplayName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Plain-text filter cell for bulk Excel, e.g. `Metal: Gold; Color: White` or `Metal = Gold`
 * (one pair per sub-segment; multi-select values separated by commas).
 */
export function parseFiltersPlain(
  raw: string,
  filterSchema: FilterField[],
): { ok: true; filter: ProductFilterValue[] } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) return { ok: true, filter: [] };

  if (!filterSchema.length) {
    return {
      ok: false,
      error:
        "This subcategory has no filter fields; remove the filters column or pick another subcategory.",
    };
  }

  const segments = t
    .split(/[;\n]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: ProductFilterValue[] = [];

  for (const seg of segments) {
    const eqIdx = seg.indexOf("=");
    const colIdx = seg.indexOf(":");
    let sep = -1;
    if (colIdx >= 0 && (eqIdx < 0 || colIdx < eqIdx)) sep = colIdx;
    else if (eqIdx >= 0) sep = eqIdx;
    if (sep < 0) {
      return {
        ok: false,
        error: `Invalid filter "${seg}". Use "Label: value" or "Label = value" (see subcategory filter labels).`,
      };
    }
    const namePart = seg.slice(0, sep).trim();
    const valuePart = seg.slice(sep + 1).trim();
    if (!namePart || !valuePart) {
      return { ok: false, error: `Invalid filter segment "${seg}".` };
    }

    const field = filterSchema.find(
      (f) =>
        normalizeDisplayName(f.label) === normalizeDisplayName(namePart) ||
        normalizeDisplayName(f.key) === normalizeDisplayName(namePart),
    );
    if (!field) {
      const names = filterSchema.map((f) => f.label).join(", ");
      return { ok: false, error: `Unknown filter "${namePart}". Use one of: ${names}` };
    }

    const filterName = field.label || field.key;

    if (field.type === "multi_chips") {
      const parts = valuePart.split(/[,/|]/g).map((x) => x.trim()).filter(Boolean);
      const values: string[] = [];
      for (const p of parts) {
        const opt = field.options.find(
          (o) =>
            normalizeDisplayName(o.label) === normalizeDisplayName(p) ||
            normalizeDisplayName(o.value) === normalizeDisplayName(p),
        );
        if (!opt) {
          const opts = field.options.map((o) => o.label).join(", ");
          return {
            ok: false,
            error: `Invalid value "${p}" for "${field.label}". Choose from: ${opts}`,
          };
        }
        values.push(opt.value);
      }
      if (values.length) out.push({ filterName, filterValue: values });
    } else {
      const opt = field.options.find(
        (o) =>
          normalizeDisplayName(o.label) === normalizeDisplayName(valuePart) ||
          normalizeDisplayName(o.value) === normalizeDisplayName(valuePart),
      );
      if (!opt) {
        const opts = field.options.map((o) => o.label).join(", ");
        return {
          ok: false,
          error: `Invalid value "${valuePart}" for "${field.label}". Choose from: ${opts}`,
        };
      }
      out.push({ filterName, filterValue: opt.value });
    }
  }

  return { ok: true, filter: out };
}

export type AdminProductCreateInput = {
  styleNo: string;
  categoryId: string;
  subcategoryProfileId?: string;
  subcategoryId: string;
  makeType?: string;
  description?: string;
  remarks?: string;
  diamonds?: Diamond[];
  totalDiamondPcs?: number;
  totalDiamondWeightCt?: number;
  pointer?: number;
  metalWeights?: MetalWeights;
  images?: string[];
  embedding?: number[];
  displayOrder?: number;
  isActive?: boolean;
  isBestSeller?: boolean;
  isReadyToShip?: boolean;
  filter?: ProductFilterValue[];
};

function parseMetalWeightEntry(rawEntry: unknown, fallbackLabel: string) {
  if (Number.isFinite(rawEntry)) {
    return { label: fallbackLabel, value: Number(rawEntry) };
  }
  if (typeof rawEntry !== "object" || rawEntry === null) {
    return undefined;
  }
  const entry = rawEntry as Record<string, unknown>;
  const label = asTrimmedString(entry.label) ?? fallbackLabel;
  const value = Number.isFinite(entry.value) ? Number(entry.value) : undefined;
  if (!label && value === undefined) return undefined;
  return { label, value };
}

/** Parse request body the same way as POST /admin/products */
export function parseAdminProductBody(body: Record<string, unknown>): AdminProductCreateInput | null {
  const styleNo = asTrimmedString(body.styleNo);
  const categoryId = asTrimmedString(body.categoryId);
  const subcategoryProfileId = asTrimmedString(body.subcategoryProfileId);
  const subcategoryId = asTrimmedString(body.subcategoryId);
  const makeType = asTrimmedString(body.makeType);
  const description = asTrimmedString(body.description);
  const remarks = asTrimmedString(body.remarks);
  const totalDiamondPcs = Number.isFinite(body.totalDiamondPcs) ? Number(body.totalDiamondPcs) : 0;
  const totalDiamondWeightCt = Number.isFinite(body.totalDiamondWeightCt)
    ? Number(body.totalDiamondWeightCt)
    : 0;
  const pointer = Number.isFinite(body.pointer) ? Number(body.pointer) : 0;
  const displayOrder = Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true;
  const isBestSeller = typeof body.isBestSeller === "boolean" ? body.isBestSeller : false;
  const isReadyToShip = typeof body.isReadyToShip === "boolean" ? body.isReadyToShip : false;
  const images = Array.isArray(body.images)
    ? body.images
        .map((image) => asTrimmedString(image))
        .filter((image): image is string => Boolean(image))
    : [];
  const embedding = Array.isArray(body.embedding)
    ? body.embedding
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    : [];
  const diamonds = Array.isArray(body.diamonds)
    ? body.diamonds
        .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
        .map((entry) => ({
          shape: asTrimmedString(entry.shape),
          sieveSize: asTrimmedString(entry.sieveSize),
          mmSize: asTrimmedString(entry.mmSize),
          pcs: Number.isFinite(entry.pcs) ? Number(entry.pcs) : undefined,
          avgPointer: Number.isFinite(entry.avgPointer) ? Number(entry.avgPointer) : undefined,
          ctWeight: Number.isFinite(entry.ctWeight) ? Number(entry.ctWeight) : undefined,
        }))
    : [];
  const rawMetalWeights =
    typeof body.metalWeights === "object" && body.metalWeights !== null ? body.metalWeights : {};
  const metalWeights = {
    gold10K: parseMetalWeightEntry(
      (rawMetalWeights as Record<string, unknown>).gold10K,
      "Gold 10K",
    ),
    gold14K: parseMetalWeightEntry(
      (rawMetalWeights as Record<string, unknown>).gold14K,
      "Gold 14K",
    ),
    gold18K: parseMetalWeightEntry(
      (rawMetalWeights as Record<string, unknown>).gold18K,
      "Gold 18K",
    ),
    silver: parseMetalWeightEntry((rawMetalWeights as Record<string, unknown>).silver, "Silver"),
    platinum: parseMetalWeightEntry(
      (rawMetalWeights as Record<string, unknown>).platinum,
      "Platinum",
    ),
  };

  const filter = Array.isArray(body.filter)
    ? body.filter
        .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
        .map((entry) => {
          const filterName = String(entry.filterName ?? "").trim();
          const rawValue = entry.filterValue;
          const filterValue = Array.isArray(rawValue)
            ? rawValue.map((v) => String(v ?? "").trim()).filter(Boolean)
            : String(rawValue ?? "").trim();
          return { filterName, filterValue };
        })
        .filter((entry) => {
          if (!entry.filterName) return false;
          if (Array.isArray(entry.filterValue)) return entry.filterValue.length > 0;
          return Boolean(entry.filterValue);
        })
    : [];

  if (!styleNo || !categoryId || !subcategoryId) return null;

  return {
    styleNo,
    categoryId,
    subcategoryProfileId,
    subcategoryId,
    makeType,
    description,
    remarks,
    diamonds,
    totalDiamondPcs,
    totalDiamondWeightCt,
    pointer,
    metalWeights,
    images,
    embedding,
    displayOrder,
    isActive,
    isBestSeller,
    isReadyToShip,
    filter,
  };
}

export type CreateAdminProductResult =
  | { ok: true; product: ProductDocument }
  | { ok: false; status: number; error: string };

export async function createAdminProduct(input: AdminProductCreateInput): Promise<CreateAdminProductResult> {
  const {
    styleNo,
    categoryId,
    subcategoryProfileId,
    subcategoryId,
    makeType,
    description,
    remarks,
    diamonds = [],
    totalDiamondPcs = 0,
    totalDiamondWeightCt = 0,
    pointer = 0,
    metalWeights = {},
    images = [],
    embedding = [],
    displayOrder = 0,
    isActive = true,
    isBestSeller = false,
    isReadyToShip = false,
    filter = [],
  } = input;

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    return { ok: false, status: 400, error: "Invalid categoryId" };
  }
  if (!mongoose.Types.ObjectId.isValid(subcategoryId)) {
    return { ok: false, status: 400, error: "Invalid subcategoryId" };
  }
  if (subcategoryProfileId && !mongoose.Types.ObjectId.isValid(subcategoryProfileId)) {
    return { ok: false, status: 400, error: "Invalid subcategoryProfileId" };
  }

  const category = await Category.findById(categoryId).select("_id");
  if (!category) return { ok: false, status: 404, error: "Category not found" };

  if (subcategoryProfileId) {
    const subcategoryProfile = await SubcategoryProfile.findById(subcategoryProfileId).select(
      "_id categoryId",
    );
    if (!subcategoryProfile) return { ok: false, status: 404, error: "Subcategory profile not found" };
    if (String(subcategoryProfile.categoryId) !== categoryId) {
      return { ok: false, status: 400, error: "Subcategory profile must belong to selected category" };
    }
  }

  const subcategory = await Subcategory.findById(subcategoryId).select("_id categoryId subcategoryProfileId");
  if (!subcategory) return { ok: false, status: 404, error: "Subcategory not found" };
  if (String(subcategory.categoryId) !== categoryId) {
    return { ok: false, status: 400, error: "Subcategory must belong to selected category" };
  }
  if (subcategoryProfileId) {
    if (String(subcategory.subcategoryProfileId ?? "") !== subcategoryProfileId) {
      return { ok: false, status: 400, error: "Subcategory must belong to selected subcategory profile" };
    }
  } else if (subcategory.subcategoryProfileId) {
    return { ok: false, status: 400, error: "Subcategory profile is required for this subcategory" };
  }

  const existingStyle = await Product.findOne({ styleNo }).select("_id");
  if (existingStyle) return { ok: false, status: 409, error: "styleNo already exists" };

  const product = await Product.create({
    styleNo,
    categoryId,
    subcategoryProfileId,
    subcategoryId,
    makeType,
    description,
    remarks,
    diamonds,
    totalDiamondPcs,
    totalDiamondWeightCt,
    pointer,
    metalWeights,
    images,
    embedding,
    displayOrder,
    isActive,
    isBestSeller,
    isReadyToShip,
    filter,
  });

  await Category.updateOne({ _id: categoryId }, { $inc: { productCount: 1 } });
  await Subcategory.updateOne({ _id: subcategoryId }, { $inc: { productCount: 1 } });

  return { ok: true, product };
}

/**
 * Resolves category / subcategory profile / subcategory by **display name** only.
 * Each name must already exist in the database (created in the admin panel). Nothing is auto-created.
 * Only **active** records are matched; inactive matches get a specific error.
 */
export async function resolveHierarchyByNames(params: {
  categoryName: string;
  subcategoryProfileName?: string;
  subcategoryName: string;
}): Promise<
  | { ok: true; categoryId: string; subcategoryProfileId?: string; subcategoryId: string }
  | { ok: false; error: string }
> {
  const catName = asTrimmedString(params.categoryName);
  const subName = asTrimmedString(params.subcategoryName);
  const profileName = asTrimmedString(params.subcategoryProfileName);

  if (!catName) return { ok: false, error: "category name is required" };
  if (!subName) return { ok: false, error: "subcategory name is required" };

  const categories = await Category.find().select("_id name isActive");
  const category = categories.find((c) => normalizeDisplayName(c.name) === normalizeDisplayName(catName));
  if (!category) {
    return {
      ok: false,
      error: `Category "${catName}" does not exist. Create it in Admin → Categories first; the Excel name must match that category (ignoring case and extra spaces).`,
    };
  }
  if (!category.isActive) {
    return {
      ok: false,
      error: `Category "${catName}" exists but is inactive. Activate it in Admin → Categories or use an active category name.`,
    };
  }

  const categoryId = String(category._id);

  let resolvedProfileId: string | undefined;
  if (profileName) {
    const profiles = await SubcategoryProfile.find({ categoryId }).select("_id name isActive");
    const prof = profiles.find((p) => normalizeDisplayName(p.name) === normalizeDisplayName(profileName));
    if (!prof) {
      return {
        ok: false,
        error: `Subcategory profile "${profileName}" does not exist under this category. Create it in Admin (subcategory profiles for this category) first; names must match.`,
      };
    }
    if (!prof.isActive) {
      return {
        ok: false,
        error: `Subcategory profile "${profileName}" exists but is inactive. Activate it in Admin or use an active profile name.`,
      };
    }
    resolvedProfileId = String(prof._id);
  }

  const subs = await Subcategory.find({ categoryId }).select("_id name subcategoryProfileId isActive");
  const normSub = normalizeDisplayName(subName);
  const sameName = subs.filter((s) => normalizeDisplayName(s.name) === normSub);
  const nameMatches = sameName.filter((s) => s.isActive);
  const inactiveSameName = sameName.filter((s) => !s.isActive);

  if (nameMatches.length === 0) {
    if (inactiveSameName.length > 0) {
      return {
        ok: false,
        error: `Subcategory "${subName}" exists but is inactive. Activate it in Admin → Subcategories or use an active subcategory name.`,
      };
    }
    return {
      ok: false,
      error: `Subcategory "${subName}" does not exist under this category. Create it in Admin → Subcategories first; the Excel name must match an existing subcategory for this category.`,
    };
  }

  if (resolvedProfileId) {
    const withProfile = nameMatches.filter((s) => String(s.subcategoryProfileId ?? "") === resolvedProfileId);
    if (withProfile.length !== 1) {
      return {
        ok: false,
        error: `No active subcategory "${subName}" found for profile "${profileName}" under this category. Create the subcategory under that profile in Admin first, or fix the profile name in Excel.`,
      };
    }
    return {
      ok: true,
      categoryId,
      subcategoryProfileId: resolvedProfileId,
      subcategoryId: String(withProfile[0]._id),
    };
  }

  const legacyMatches = nameMatches.filter((s) => !s.subcategoryProfileId);
  if (legacyMatches.length === 1) {
    return {
      ok: true,
      categoryId,
      subcategoryId: String(legacyMatches[0]._id),
    };
  }
  if (legacyMatches.length > 1) {
    return {
      ok: false,
      error: `Multiple active subcategories named "${subName}" under this category; add a subcategory profile column in Excel to pick the correct one (must match an existing profile in Admin).`,
    };
  }

  if (nameMatches.length === 1) {
    const only = nameMatches[0];
    const pid = only.subcategoryProfileId ? String(only.subcategoryProfileId) : undefined;
    return {
      ok: true,
      categoryId,
      subcategoryProfileId: pid,
      subcategoryId: String(only._id),
    };
  }

  return {
    ok: false,
    error: `Multiple active subcategories named "${subName}" under this category; specify subcategoryProfile in Excel to match an existing profile from Admin.`,
  };
}

export function cellToString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return String(v).trim();
}

function parseBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  const s = cellToString(v).toLowerCase();
  if (!s) return undefined;
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return undefined;
}

function parseNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = cellToString(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function splitList(v: unknown): string[] {
  const s = cellToString(v);
  if (!s) return [];
  return s
    .split(/[,|]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitNumbers(v: unknown): number[] {
  return splitList(v)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
}

/** Map spreadsheet header cell to canonical field key */
function headerToCanonical(raw: string): string | null {
  const n = raw
    .trim()
    .toLowerCase()
    .replace(/[#]/g, "")
    .replace(/[\s-]+/g, "_");

  const aliases: Record<string, string> = {
    style_no: "styleNo",
    styleno: "styleNo",
    category: "category",
    category_name: "category",
    subcategory: "subcategory",
    subcategory_name: "subcategory",
    subcategory_profile: "subcategoryProfile",
    subcategoryprofile: "subcategoryProfile",
    profile: "subcategoryProfile",
    make_type: "makeType",
    description: "description",
    remarks: "remarks",
    total_diamond_pcs: "totalDiamondPcs",
    total_diamond_weight_ct: "totalDiamondWeightCt",
    pointer: "pointer",
    display_order: "displayOrder",
    is_active: "isActive",
    is_bestseller: "isBestSeller",
    is_best_seller: "isBestSeller",
    is_ready_to_ship: "isReadyToShip",
    images: "images",
    image_urls: "images",
    embedding: "embedding",
    /** Plain text, e.g. `Metal: Gold; Color: White` */
    filters: "filtersPlain",
    filter_text: "filtersPlain",
    filters_plain: "filtersPlain",
    filter_values: "filtersPlain",
    gold_10k: "gold10K",
    gold10k: "gold10K",
    gold_14k: "gold14K",
    gold14k: "gold14K",
    gold_18k: "gold18K",
    gold18k: "gold18K",
    silver: "silver",
    platinum: "platinum",
    diamond_item_code: "diamondItemCode",
    diamond_code: "diamondItemCode",
    diamond_shape: "diamondShape",
    diamond_sieve: "diamondSieveSize",
    diamond_sieve_size: "diamondSieveSize",
    diamond_mm: "diamondMmSize",
    diamond_mm_size: "diamondMmSize",
    diamond_size: "diamondSize",
    diamond_pcs: "diamondPcs",
    diamond_avg_pointer: "diamondAvgPointer",
    diamond_pointer: "diamondAvgPointer",
    diamond_ct: "diamondCtWeight",
    diamond_ct_weight: "diamondCtWeight",
    diamond_wt: "diamondCtWeight",
    metal_item_code: "metalItemCode",
    metal_code: "metalItemCode",
    metal_wt: "metalWt",
    metal_weight: "metalWt",
    sr_no: "srNo",
    serial_no: "srNo",
    style_date: "styleDate",
    qty: "qty",
    item_size: "itemSize",
  };

  if (aliases[n]) return aliases[n];
  return null;
}

export type BulkSheetRow = Record<string, unknown>;

/** One product = one SKU; extra diamond/metal lines use the next row with Style No left blank. */
export type BulkStyleGroup = {
  styleNo: string;
  rows: BulkSheetRow[];
  /** Excel row number (1-based) of the first row of this group (header is row 1). */
  excelStartRow: number;
};

function rowHasAnyCellContent(row: BulkSheetRow): boolean {
  for (const v of Object.values(row)) {
    if (cellToString(v)) return true;
  }
  return false;
}

/**
 * Group rows by Style No: a new Style No starts a new product; rows with an empty Style No
 * continue the previous product (extra diamond/metal lines), same as a typical jewelry spreadsheet.
 */
export function groupBulkRowsIntoStyleGroups(
  rows: BulkSheetRow[],
): { ok: true; groups: BulkStyleGroup[] } | { ok: false; error: string; excelRow: number } {
  const groups: BulkStyleGroup[] = [];
  let current: BulkSheetRow[] | null = null;
  let currentStyle: string | null = null;
  let currentStartRow = 2;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const excelRow = i + 2;
    if (!rowHasAnyCellContent(row)) continue;

    const sn = asTrimmedString(cellToString(row.styleNo));
    if (sn) {
      if (current && currentStyle) {
        groups.push({ styleNo: currentStyle, rows: current, excelStartRow: currentStartRow });
      }
      current = [row];
      currentStyle = sn;
      currentStartRow = excelRow;
    } else {
      if (!current || !currentStyle) {
        return {
          ok: false,
          error:
            "A row has data but no Style No — it must follow a row that already has a Style No (leave Style No blank only for extra diamond/metal lines on the previous style).",
          excelRow,
        };
      }
      current.push(row);
    }
  }

  if (current && currentStyle) {
    groups.push({ styleNo: currentStyle, rows: current, excelStartRow: currentStartRow });
  }

  return { ok: true, groups };
}

/** One diamond line from a single sheet row (same columns repeated on continuation rows for more stones). */
export function extractDiamondLineFromRow(row: BulkSheetRow): Diamond | null {
  const itemCode = asTrimmedString(cellToString(row.diamondItemCode));
  const shape = asTrimmedString(cellToString(row.diamondShape));
  const sizeCol = asTrimmedString(cellToString(row.diamondSize));
  const sieveSize = asTrimmedString(cellToString(row.diamondSieveSize));
  const mmSize = asTrimmedString(cellToString(row.diamondMmSize));
  const pcs = parseNumber(row.diamondPcs);
  const avgPointer = parseNumber(row.diamondAvgPointer);
  const ctWeight = parseNumber(row.diamondCtWeight);

  const finalSieve = itemCode || sieveSize;
  const finalMm = sizeCol || mmSize;
  const hasAny =
    Boolean(finalSieve) ||
    Boolean(shape) ||
    Boolean(finalMm) ||
    pcs !== undefined ||
    avgPointer !== undefined ||
    ctWeight !== undefined;
  if (!hasAny) return null;

  return {
    shape,
    sieveSize: finalSieve,
    mmSize: finalMm,
    pcs,
    avgPointer,
    ctWeight,
  };
}

type MetalSlotKey = "gold10K" | "gold14K" | "gold18K" | "silver" | "platinum";

function mapMetalItemCodeToSlot(code: string): MetalSlotKey | null {
  const u = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!u) return null;
  if (/\b18K\b|18KT|G18|AU750/.test(u) || (u.includes("18") && u.includes("K"))) return "gold18K";
  if (/\b14K\b|14KT|G14|GB14|RG14/.test(u) || (u.includes("14") && u.includes("K"))) return "gold14K";
  if (/\b10K\b|10KT|G10/.test(u) || (u.includes("10") && u.includes("K"))) return "gold10K";
  if (/SILVER|925|STERLING|\bAG\b/.test(u)) return "silver";
  if (/PLAT|PT950|PT900|PT\d/.test(u)) return "platinum";
  return null;
}

function extractMetalLineFromRow(row: BulkSheetRow): { slot: MetalSlotKey; weight: number } | null {
  const code = asTrimmedString(cellToString(row.metalItemCode));
  const wt = parseNumber(row.metalWt);
  if (!code || wt === undefined) return null;
  const slot = mapMetalItemCodeToSlot(code);
  if (!slot) {
    return null;
  }
  return { slot, weight: wt };
}

function aggregateMetalWeightsFromGroup(rows: BulkSheetRow[]): { ok: true; metal: MetalWeights } | { ok: false; error: string } {
  const acc: Record<MetalSlotKey, number> = {
    gold10K: 0,
    gold14K: 0,
    gold18K: 0,
    silver: 0,
    platinum: 0,
  };

  for (const row of rows) {
    acc.gold10K += parseNumber(row.gold10K) ?? 0;
    acc.gold14K += parseNumber(row.gold14K) ?? 0;
    acc.gold18K += parseNumber(row.gold18K) ?? 0;
    acc.silver += parseNumber(row.silver) ?? 0;
    acc.platinum += parseNumber(row.platinum) ?? 0;

    const line = extractMetalLineFromRow(row);
    if (line) {
      acc[line.slot] += line.weight;
    } else {
      const code = asTrimmedString(cellToString(row.metalItemCode));
      const wt = parseNumber(row.metalWt);
      if (code && wt !== undefined && !mapMetalItemCodeToSlot(code)) {
        return {
          ok: false,
          error: `Unknown metal item code "${code}". Use a recognizable code (e.g. G14KT, G18KT, PLAT) or leave metal columns blank.`,
        };
      }
    }
  }

  return {
    ok: true,
    metal: {
      gold10K: { label: "Gold 10K", value: acc.gold10K },
      gold14K: { label: "Gold 14K", value: acc.gold14K },
      gold18K: { label: "Gold 18K", value: acc.gold18K },
      silver: { label: "Silver", value: acc.silver },
      platinum: { label: "Platinum", value: acc.platinum },
    },
  };
}

export function parseBulkExcelBuffer(buffer: Buffer): BulkSheetRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const out: BulkSheetRow[] = [];
  for (const row of raw) {
    const mapped: BulkSheetRow = {};
    for (const [k, v] of Object.entries(row)) {
      const canon = headerToCanonical(String(k));
      if (canon) mapped[canon] = v;
    }
    out.push(mapped);
  }
  return out;
}

export function bulkProductGroupToAdminInput(
  group: BulkStyleGroup,
  hierarchy: { categoryId: string; subcategoryProfileId?: string; subcategoryId: string },
  filterSchema: FilterField[],
): { ok: true; input: AdminProductCreateInput } | { ok: false; error: string } {
  const styleNo = asTrimmedString(group.styleNo);
  if (!styleNo) return { ok: false, error: "styleNo is required" };

  const first = group.rows[0];
  if (!asTrimmedString(cellToString(first.category)) || !asTrimmedString(cellToString(first.subcategory))) {
    return {
      ok: false,
      error: "category and subcategory are required on the first row of each Style No",
    };
  }

  const diamonds: Diamond[] = [];
  for (const row of group.rows) {
    const d = extractDiamondLineFromRow(row);
    if (d) diamonds.push(d);
  }
  const diamondsOut = diamonds.length ? diamonds : undefined;

  const filtersText =
    group.rows.map((r) => asTrimmedString(cellToString(r.filtersPlain))).find(Boolean) ?? "";
  let filter: ProductFilterValue[] | undefined;
  if (filtersText) {
    const parsed = parseFiltersPlain(filtersText, filterSchema);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    filter = parsed.filter.length ? parsed.filter : undefined;
  }

  const metalAgg = aggregateMetalWeightsFromGroup(group.rows);
  if (!metalAgg.ok) return { ok: false, error: metalAgg.error };

  const fr = first;
  let totalDiamondPcs = parseNumber(fr.totalDiamondPcs);
  let totalDiamondWeightCt = parseNumber(fr.totalDiamondWeightCt);
  if (totalDiamondPcs === undefined && diamondsOut?.length) {
    totalDiamondPcs = diamondsOut.reduce((s, d) => s + (d.pcs ?? 0), 0);
  }
  if (totalDiamondWeightCt === undefined && diamondsOut?.length) {
    totalDiamondWeightCt = diamondsOut.reduce((s, d) => s + (d.ctWeight ?? 0), 0);
  }

  const isActive = parseBool(fr.isActive);
  const isBestSeller = parseBool(fr.isBestSeller);
  const isReadyToShip = parseBool(fr.isReadyToShip);

  const qty = asTrimmedString(cellToString(fr.qty));
  const itemSize = asTrimmedString(cellToString(fr.itemSize));
  const styleDate = asTrimmedString(cellToString(fr.styleDate));
  const baseRemarks = asTrimmedString(cellToString(fr.remarks)) ?? "";
  const extraBits: string[] = [];
  if (qty) extraBits.push(`Qty: ${qty}`);
  if (itemSize) extraBits.push(`Item size: ${itemSize}`);
  if (styleDate) extraBits.push(`Style date: ${styleDate}`);
  const remarksMerged = [baseRemarks, extraBits.filter(Boolean).join(" | ")].filter(Boolean).join(" | ");

  return {
    ok: true,
    input: {
      styleNo,
      categoryId: hierarchy.categoryId,
      subcategoryProfileId: hierarchy.subcategoryProfileId,
      subcategoryId: hierarchy.subcategoryId,
      makeType: asTrimmedString(cellToString(fr.makeType)),
      description: asTrimmedString(cellToString(fr.description)),
      remarks: remarksMerged || undefined,
      diamonds: diamondsOut,
      totalDiamondPcs: totalDiamondPcs ?? 0,
      totalDiamondWeightCt: totalDiamondWeightCt ?? 0,
      pointer: parseNumber(fr.pointer) ?? 0,
      metalWeights: metalAgg.metal,
      images: splitList(fr.images),
      embedding: splitNumbers(fr.embedding),
      displayOrder: parseNumber(fr.displayOrder) ?? 0,
      isActive: isActive ?? true,
      isBestSeller: isBestSeller ?? false,
      isReadyToShip: isReadyToShip ?? false,
      filter,
    },
  };
}
