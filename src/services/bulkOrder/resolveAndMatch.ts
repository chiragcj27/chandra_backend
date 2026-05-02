import { Product } from "../../models/Product";
import { Subcategory } from "../../models/Subcategory";
import type { BulkOrderCatalogCategory } from "./catalogContext";
import { normalizeToken } from "./catalogContext";
import { canonicalBulkOrderStoneType, type ParsedBulkOrderLine } from "./llmParser";

type OptionValue = { label: string; value: string };
type MissingField = { field: string; label: string; options: OptionValue[] };

type ResolvedLine = {
  lineRef: string;
  status: "matched" | "needs_input";
  category: string;
  subcategoryProfile: string;
  subcategory: string;
  filters: Record<string, string | string[]>;
  metalType: string;
  stoneType: string;
  caratOrPointer: string;
  qtyWhite: number;
  qtyYellow: number;
  qtyRose: number;
  totalQty: number;
  missingFields: MissingField[];
  matchedProduct?: {
    productId: string;
    styleNo: string;
    description: string;
    imageUrl: string;
    pointer: number;
    totalDiamondWeightCt: number;
    subcategoryId: string;
    categoryName: string;
    subcategoryName: string;
    subcategoryProfileName: string;
    subcategoryThumbnailImage: string;
    subcategoryDescription: string;
    subcategorySubtext: string;
    specialNotePlaceholderText: string;
    filter: Array<{ filterName: string; filterValue: string | string[] }>;
    metalWeights: Record<string, unknown>;
    diamonds: Array<Record<string, unknown>>;
    price: number;
    sellingPrice: number;
    mrp: number;
  };
};

function normalizeQty(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function isValidCaratOrPointer(value: string): boolean {
  if (!value.trim()) return false;
  return /(\d+(\.\d+)?)\s*(ct|carat|pointer|pt)?/i.test(value.trim());
}

function toOptions(values: string[]): OptionValue[] {
  return values.map((value) => ({ label: value, value }));
}

function buildLineSelectedFilters(resolved: ResolvedLine): Record<string, string> {
  const out: Record<string, string> = {};
  if (resolved.metalType) out.metal = resolved.metalType;
  if (resolved.stoneType) out.stone = resolved.stoneType;
  const lengthValue = Object.values(resolved.filters || {}).find((value) => {
    const s = String(value || "").toLowerCase();
    return s.includes("10") || s.includes("16") || s.includes("18");
  });
  if (lengthValue) out.length = String(lengthValue);
  return out;
}

function applyOverrides(
  lines: ParsedBulkOrderLine[],
  overrides: Record<string, Record<string, unknown>> | undefined
): ParsedBulkOrderLine[] {
  if (!overrides) return lines;
  return lines.map((line) => {
    const patch = overrides[line.lineRef];
    if (!patch || typeof patch !== "object") return line;
    return {
      ...line,
      category: String(patch.category ?? line.category ?? ""),
      subcategoryProfile: String(patch.subcategoryProfile ?? line.subcategoryProfile ?? ""),
      subcategory: String(patch.subcategory ?? line.subcategory ?? ""),
      metalType: String(patch.metalType ?? line.metalType ?? ""),
      stoneType: canonicalBulkOrderStoneType(String(patch.stoneType ?? line.stoneType ?? "")),
      caratOrPointer: String(patch.caratOrPointer ?? line.caratOrPointer ?? ""),
      qtyWhite: patch.qtyWhite !== undefined ? normalizeQty(patch.qtyWhite) : line.qtyWhite,
      qtyYellow: patch.qtyYellow !== undefined ? normalizeQty(patch.qtyYellow) : line.qtyYellow,
      qtyRose: patch.qtyRose !== undefined ? normalizeQty(patch.qtyRose) : line.qtyRose,
      filters: patch.filters && typeof patch.filters === "object" ? (patch.filters as Record<string, string | string[]>) : line.filters,
    };
  });
}

function pickMatchedValue(input: string, values: string[]): string {
  const token = normalizeToken(input);
  if (!token) return "";
  return values.find((v) => normalizeToken(v) === token) || "";
}

function parseCaratOrPointer(value: string): { pointer: number | null; carat: number | null } {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return { pointer: null, carat: null };
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric <= 0) return { pointer: null, carat: null };

  if (text.includes("pointer") || text.includes("pt")) {
    return { pointer: numeric, carat: Number((numeric / 100).toFixed(3)) };
  }
  if (text.includes("ct") || text.includes("carat")) {
    return { pointer: Number((numeric * 100).toFixed(2)), carat: numeric };
  }

  // Bare numbers are interpreted as pointer in this catalog flow.
  return { pointer: numeric, carat: Number((numeric / 100).toFixed(3)) };
}

function scoreProductMatch(args: {
  targetPointer: number | null;
  targetCarat: number | null;
  productPointer: number;
  productCarat: number;
}): number {
  const { targetPointer, targetCarat, productPointer, productCarat } = args;
  if (targetPointer !== null && Number.isFinite(productPointer)) {
    return Math.abs(productPointer - targetPointer);
  }
  if (targetCarat !== null && Number.isFinite(productCarat)) {
    return Math.abs(productCarat - targetCarat);
  }
  return Number.MAX_SAFE_INTEGER / 2;
}

export async function resolveAndMatchBulkOrder(args: {
  parsedLines: ParsedBulkOrderLine[];
  overrides?: Record<string, Record<string, unknown>>;
  catalogContext: { categories: BulkOrderCatalogCategory[] };
}) {
  const startedAt = Date.now();
  console.log("[BulkOrderResolve] resolve started", {
    parsedLinesCount: args.parsedLines.length,
    overridesCount: args.overrides ? Object.keys(args.overrides).length : 0,
    categoriesInContext: args.catalogContext.categories.length,
  });
  const patchedLines = applyOverrides(args.parsedLines, args.overrides);
  const resolvedLines: ResolvedLine[] = [];

  for (const line of patchedLines) {
    const missingFields: MissingField[] = [];
    const allCategories = args.catalogContext.categories;
    const matchedCategory = pickMatchedValue(
      line.category,
      allCategories.map((c) => c.name)
    );
    const category = allCategories.find((c) => c.name === matchedCategory) || null;
    if (!category) {
      missingFields.push({
        field: "category",
        label: "Category",
        options: toOptions(allCategories.map((c) => c.name)),
      });
    }

    const profiles = category?.profiles || [];
    const matchedProfile = pickMatchedValue(
      line.subcategoryProfile,
      profiles.map((p) => p.name)
    );
    const profile = profiles.find((p) => p.name === matchedProfile) || null;
    if (category && !profile) {
      missingFields.push({
        field: "subcategoryProfile",
        label: "Subcategory Profile",
        options: toOptions(profiles.map((p) => p.name)),
      });
    }

    const subcategories = profile?.subcategories || [];
    const matchedSubcategory = pickMatchedValue(
      line.subcategory,
      subcategories.map((s) => s.name)
    );
    const subcategory = subcategories.find((s) => s.name === matchedSubcategory) || null;
    if (profile && !subcategory) {
      missingFields.push({
        field: "subcategory",
        label: "Subcategory",
        options: toOptions(subcategories.map((s) => s.name)),
      });
    }

    if (!isValidCaratOrPointer(line.caratOrPointer)) {
      missingFields.push({
        field: "caratOrPointer",
        label: "Carat / Pointer",
        options: [],
      });
    }

    const qtyWhite = normalizeQty(line.qtyWhite);
    const qtyYellow = normalizeQty(line.qtyYellow);
    const qtyRose = normalizeQty(line.qtyRose);
    const totalQty = qtyWhite + qtyYellow + qtyRose;
    if (totalQty < 1) {
      missingFields.push({
        field: "qty",
        label: "Quantity (White/Yellow/Rose)",
        options: [],
      });
    }

    const stoneCanonical = canonicalBulkOrderStoneType(line.stoneType);
    if (!stoneCanonical) {
      missingFields.push({
        field: "stoneType",
        label: "Stone type",
        options: [
          { label: "Natural", value: "Natural" },
          { label: "Lab grown", value: "LabGrown" },
        ],
      });
    }

    const allowedFilters = subcategory?.filters || [];
    const normalizedInputFilters = line.filters || {};
    const normalizedResolvedFilters: Record<string, string | string[]> = {};
    for (const filter of allowedFilters) {
      const raw = Object.entries(normalizedInputFilters).find(
        ([key]) => normalizeToken(key) === normalizeToken(filter.name)
      )?.[1];
      if (raw === undefined) continue;
      if (Array.isArray(raw)) {
        const selected = raw.map((r) => String(r)).filter((r) => pickMatchedValue(r, filter.values));
        if (selected.length > 0) normalizedResolvedFilters[filter.name] = selected;
      } else {
        const selected = pickMatchedValue(String(raw), filter.values);
        if (selected) normalizedResolvedFilters[filter.name] = selected;
      }
    }

    let matchedProduct: ResolvedLine["matchedProduct"] | undefined;
    if (subcategory && missingFields.length === 0) {
      const subcategoryDoc = await Subcategory.findById(subcategory.id)
        .select("thumbnailImage description subtext specialNotePlaceholderText")
        .lean()
        .catch(() => null);
      const parsedTarget = parseCaratOrPointer(line.caratOrPointer);
      const products = await Product.find({ subcategoryId: subcategory.id, isActive: true })
        .select(
          "_id styleNo description images pointer totalDiamondWeightCt filter metalWeights diamonds price sellingPrice mrp"
        )
        .sort({ displayOrder: 1, createdAt: -1 })
        .limit(100)
        .lean();
      const product = [...products].sort((a, b) => {
        const scoreA = scoreProductMatch({
          targetPointer: parsedTarget.pointer,
          targetCarat: parsedTarget.carat,
          productPointer: Number(a.pointer || 0),
          productCarat: Number(a.totalDiamondWeightCt || 0),
        });
        const scoreB = scoreProductMatch({
          targetPointer: parsedTarget.pointer,
          targetCarat: parsedTarget.carat,
          productPointer: Number(b.pointer || 0),
          productCarat: Number(b.totalDiamondWeightCt || 0),
        });
        return scoreA - scoreB;
      })[0];
      if (product) {
        console.log("[BulkOrderResolve] product matched by pointer/carat", {
          lineRef: line.lineRef,
          caratOrPointer: line.caratOrPointer,
          targetPointer: parsedTarget.pointer,
          targetCarat: parsedTarget.carat,
          matchedProductId: String(product._id),
          matchedPointer: Number(product.pointer || 0),
          matchedCarat: Number(product.totalDiamondWeightCt || 0),
        });
        matchedProduct = {
          productId: String(product._id),
          styleNo: String(product.styleNo || ""),
          description: String(product.description || product.styleNo || ""),
          imageUrl: Array.isArray(product.images) && product.images[0] ? String(product.images[0]) : "",
          pointer: Number(product.pointer || 0),
          totalDiamondWeightCt: Number(product.totalDiamondWeightCt || 0),
          subcategoryId: String(subcategory.id),
          categoryName: category?.name || "",
          subcategoryName: subcategory.name,
          subcategoryProfileName: profile?.name || "",
          subcategoryThumbnailImage: String(subcategoryDoc?.thumbnailImage || ""),
          subcategoryDescription: String(subcategoryDoc?.description || ""),
          subcategorySubtext: String(subcategoryDoc?.subtext || ""),
          specialNotePlaceholderText: String(subcategoryDoc?.specialNotePlaceholderText || "Length variation"),
          filter: Array.isArray(product.filter) ? (product.filter as any) : [],
          metalWeights: (product.metalWeights as Record<string, unknown>) || {},
          diamonds: Array.isArray(product.diamonds) ? (product.diamonds as Array<Record<string, unknown>>) : [],
          price: Number((product as any).price || 0),
          sellingPrice: Number((product as any).sellingPrice || 0),
          mrp: Number((product as any).mrp || 0),
        };
      }
    }

    if (!matchedProduct && missingFields.length === 0) {
      missingFields.push({
        field: "matchedProduct",
        label: "Matching product",
        options: [],
      });
    }
    console.log("[BulkOrderResolve] line resolved", {
      lineRef: line.lineRef,
      status: missingFields.length === 0 ? "matched" : "needs_input",
      missingFields: missingFields.map((m) => m.field),
      matchedProductId: matchedProduct?.productId || null,
      totalQty,
    });

    resolvedLines.push({
      lineRef: line.lineRef,
      status: missingFields.length === 0 ? "matched" : "needs_input",
      category: category?.name || "",
      subcategoryProfile: profile?.name || "",
      subcategory: subcategory?.name || "",
      filters: normalizedResolvedFilters,
      metalType: line.metalType,
      stoneType: stoneCanonical,
      caratOrPointer: line.caratOrPointer,
      qtyWhite,
      qtyYellow,
      qtyRose,
      totalQty,
      missingFields,
      matchedProduct,
    });
  }

  const allResolved = resolvedLines.every((line) => line.status === "matched");
  const selectedProductLines = resolvedLines
    .filter((line) => line.matchedProduct)
    .map((line) => ({
      productId: line.matchedProduct!.productId,
      styleNo: line.matchedProduct!.styleNo,
      name: line.matchedProduct!.styleNo || line.subcategory,
      description: line.matchedProduct!.description,
      imageUrl: line.matchedProduct!.imageUrl,
      pointer: line.matchedProduct!.pointer,
      totalDiamondWeightCt: line.matchedProduct!.totalDiamondWeightCt,
      subcategoryId: line.matchedProduct!.subcategoryId,
      categoryName: line.matchedProduct!.categoryName,
      subcategoryName: line.matchedProduct!.subcategoryName,
      subcategoryProfileName: line.matchedProduct!.subcategoryProfileName,
      subcategoryThumbnailImage: line.matchedProduct!.subcategoryThumbnailImage,
      subcategoryDescription: line.matchedProduct!.subcategoryDescription,
      subcategorySubtext: line.matchedProduct!.subcategorySubtext,
      specialNotePlaceholderText: line.matchedProduct!.specialNotePlaceholderText,
      lineSelectedFilters: buildLineSelectedFilters(line),
      quantities: { W: line.qtyWhite, Y: line.qtyYellow, R: line.qtyRose },
      totalQty: line.totalQty,
      unitPrice: 0,
      note: "",
      pricingSource: {
        filter: line.matchedProduct!.filter || [],
        metalWeights: line.matchedProduct!.metalWeights || {},
        diamonds: line.matchedProduct!.diamonds || [],
        price: Number(line.matchedProduct!.price || 0),
        sellingPrice: Number(line.matchedProduct!.sellingPrice || 0),
        mrp: Number(line.matchedProduct!.mrp || 0),
      },
    }));

  const totalSelectedQty = selectedProductLines.reduce((sum, line) => sum + Number(line.totalQty || 0), 0);
  const firstLine = selectedProductLines[0];
  const firstResolved = resolvedLines[0];
  const selectedFilters: Record<string, string> = {};
  if (firstResolved?.metalType) selectedFilters.metal = firstResolved.metalType;
  if (firstResolved?.stoneType) selectedFilters.stone = firstResolved.stoneType;
  const lengthValue = Object.values(firstResolved?.filters || {}).find((value) =>
    String(value || "").toLowerCase().includes("10") ||
    String(value || "").toLowerCase().includes("16") ||
    String(value || "").toLowerCase().includes("18")
  );
  if (lengthValue) selectedFilters.length = String(lengthValue);
  console.log("[BulkOrderResolve] resolve completed", {
    itemsParsedCount: resolvedLines.length,
    itemsResolvedCount: resolvedLines.filter((line) => line.status === "matched").length,
    allResolved,
    selectedProductLines: selectedProductLines.length,
    totalSelectedQty,
    productDescription: firstLine?.subcategoryDescription || firstLine?.description || "",
    elapsedMs: Date.now() - startedAt,
  });

  return {
    itemsParsedCount: resolvedLines.length,
    itemsResolvedCount: resolvedLines.filter((line) => line.status === "matched").length,
    items: resolvedLines,
    allResolved,
    orderReviewPayload: allResolved
      ? {
          categoryName: firstLine?.categoryName || "Category",
          subcategoryProfileName: firstLine?.subcategoryProfileName || "Profile",
          subcategoryId: firstLine?.subcategoryId || "",
          subcategoryName: firstLine?.subcategoryName || "Products",
          subcategorySubtext: firstLine?.subcategorySubtext || "",
          totalSelectedQty,
          selectedProductLines,
          selectedFilters,
          specialNotePlaceholderText: firstLine?.specialNotePlaceholderText || "Length variation",
          productImageUrl: firstLine?.imageUrl || firstLine?.subcategoryThumbnailImage || "",
          productDescription: firstLine?.subcategoryDescription || firstLine?.description || "",
          subcategoryThumbnailImage: firstLine?.subcategoryThumbnailImage || firstLine?.imageUrl || "",
          isReorderFlow: false,
          parsedItemsCount: resolvedLines.length,
        }
      : null,
  };
}
