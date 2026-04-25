import crypto from "crypto";
import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { Category } from "../../models/Category";
import { Product } from "../../models/Product";
import { StoneShape } from "../../models/StoneShape";
import { Subcategory } from "../../models/Subcategory";
import { SubcategoryProfile } from "../../models/SubcategoryProfile";
import {
  bulkProductGroupToAdminInput,
  buildRingFilterSchema,
  cellToString,
  createAdminProduct,
  groupBulkRowsIntoStyleGroups,
  parseAdminProductBody,
  parseBulkExcelBuffer,
  resolveHierarchyByNames,
} from "../../services/adminProductCreate";
import { copyObject, deleteObject, headObject, s3KeyToPublicUrl } from "../../services/s3";

const router = Router();

const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function asTrimmedString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t.length ? t : undefined;
}

function getSingleParamValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

async function normalizeFilterPayloadForRingCategory(
  categoryId: string,
  inputFilter: unknown[],
): Promise<Array<{ filterName: string; filterValue: string | string[] }>> {
  const category = await Category.findById(categoryId).select("name").lean();
  const isRingCategory = String(category?.name ?? "").toLowerCase().includes("ring");
  if (!isRingCategory) {
    return inputFilter as Array<{ filterName: string; filterValue: string | string[] }>;
  }

  const normalized = (inputFilter as Array<{ filterName: string; filterValue: string | string[] }>).map(
    (entry) => {
      const filterNameRaw = String(entry?.filterName ?? "").trim();
      const normalizedName = filterNameRaw.toLowerCase().replace(/\s+/g, "");
      if (normalizedName === "stoneshape") {
        return { ...entry, filterName: "stoneShape" };
      }
      return entry;
    },
  );
  return normalized;
}

router.get("/categories", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const categories = await Category.find().sort({ displayOrder: 1, createdAt: -1 });
    return res.status(200).json({ categories });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/stone-shapes", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const stoneShapes = await StoneShape.find().sort({ displayOrder: 1, createdAt: -1 });
    return res.status(200).json({ stoneShapes });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/stone-shapes", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body as {
      name?: string;
      thumbnailImage?: string;
      displayOrder?: number;
      isActive?: boolean;
    };
    const name = asTrimmedString(body.name);
    const thumbnailImage = asTrimmedString(body.thumbnailImage);
    const displayOrder = Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0;
    const isActive = typeof body.isActive === "boolean" ? body.isActive : true;
    if (!name || !thumbnailImage) {
      return res.status(400).json({ error: "name and thumbnailImage are required" });
    }
    const stoneShape = await StoneShape.create({ name, thumbnailImage, displayOrder, isActive });
    return res.status(201).json({ stoneShape });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    if (message.includes("duplicate key")) {
      return res.status(409).json({ error: "Stone shape name already exists" });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/stone-shapes/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = getSingleParamValue(req.params.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const stoneShape = await StoneShape.findById(id);
    if (!stoneShape) return res.status(404).json({ error: "Stone shape not found" });

    const body = req.body as {
      name?: string;
      thumbnailImage?: string;
      displayOrder?: number;
      isActive?: boolean;
    };
    const name = asTrimmedString(body.name);
    const thumbnailImage = asTrimmedString(body.thumbnailImage);
    if (typeof name === "string") stoneShape.name = name;
    if (typeof thumbnailImage === "string") stoneShape.thumbnailImage = thumbnailImage;
    if (Number.isFinite(body.displayOrder)) stoneShape.displayOrder = Number(body.displayOrder);
    if (typeof body.isActive === "boolean") stoneShape.isActive = body.isActive;

    await stoneShape.save();
    return res.status(200).json({ stoneShape });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    if (message.includes("duplicate key")) {
      return res.status(409).json({ error: "Stone shape name already exists" });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/stone-shapes/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = getSingleParamValue(req.params.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const deleted = await StoneShape.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Stone shape not found" });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/categories", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as {
    name?: string;
    displayOrder?: number;
    isActive?: boolean;
    tmpKey?: string;
    categoryBannerTmpKeys?: string[];
  };

  const name = asTrimmedString(body.name);
  const tmpKey = asTrimmedString(body.tmpKey);
  const categoryBannerTmpKeys = Array.isArray(body.categoryBannerTmpKeys)
    ? body.categoryBannerTmpKeys
        .map((key) => asTrimmedString(key))
        .filter((key): key is string => Boolean(key))
    : [];
  const displayOrder = Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true;

  if (!name) return res.status(400).json({ error: "name is required" });
  if (!tmpKey) return res.status(400).json({ error: "tmpKey is required" });
  if (!tmpKey.startsWith("tmp/")) return res.status(400).json({ error: "tmpKey must start with tmp/" });
  if (categoryBannerTmpKeys.some((key) => !key.startsWith("tmp/"))) {
    return res.status(400).json({ error: "All categoryBannerTmpKeys must start with tmp/" });
  }

  let finalKey: string | null = null;
  const bannerFinalKeys: string[] = [];

  try {
    const exists = await headObject(tmpKey);
    if (!exists) return res.status(400).json({ error: "Uploaded file not found on S3" });

    const fileSuffix = tmpKey.split("/").pop() ?? crypto.randomUUID();
    finalKey = `categories/${crypto.randomUUID()}-${fileSuffix}`;
    await copyObject({ fromKey: tmpKey, toKey: finalKey });

    for (const bannerTmpKey of categoryBannerTmpKeys) {
      const bannerExists = await headObject(bannerTmpKey);
      if (!bannerExists) {
        return res.status(400).json({ error: "One or more category banner uploads are missing on S3" });
      }

      const bannerSuffix = bannerTmpKey.split("/").pop() ?? crypto.randomUUID();
      const bannerFinalKey = `categories/${crypto.randomUUID()}-${bannerSuffix}`;
      await copyObject({ fromKey: bannerTmpKey, toKey: bannerFinalKey });
      bannerFinalKeys.push(bannerFinalKey);
    }

    const created = await Category.create({
      name,
      thumbnailImage: s3KeyToPublicUrl(finalKey),
      categoryBannerImages: bannerFinalKeys.map((key) => s3KeyToPublicUrl(key)),
      displayOrder,
      isActive,
      productCount: 0,
    });

    await deleteObject(tmpKey);
    for (const bannerTmpKey of categoryBannerTmpKeys) {
      await deleteObject(bannerTmpKey);
    }
    return res.status(201).json({ category: created });
  } catch {
    try {
      if (finalKey) await deleteObject(finalKey);
    } catch {
      // best-effort cleanup
    }
    for (const bannerFinalKey of bannerFinalKeys) {
      try {
        await deleteObject(bannerFinalKey);
      } catch {
        // best-effort cleanup
      }
    }
    try {
      await deleteObject(tmpKey);
    } catch {
      // best-effort cleanup
    }
    for (const bannerTmpKey of categoryBannerTmpKeys) {
      try {
        await deleteObject(bannerTmpKey);
      } catch {
        // best-effort cleanup
      }
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/categories/:id", requireAuth, requireRole("admin"), async (req, res) => {
  let finalKey: string | null = null;
  let tmpKeyToCleanup: string | null = null;
  const bannerFinalKeys: string[] = [];
  const bannerTmpKeysToCleanup: string[] = [];
  try {
    const id = getSingleParamValue(req.params.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const body = req.body as {
      name?: string;
      displayOrder?: number;
      isActive?: boolean;
      tmpKey?: string;
      categoryBannerTmpKeys?: string[];
    };

    const category = await Category.findById(id);
    if (!category) return res.status(404).json({ error: "Category not found" });

    const name = asTrimmedString(body.name);
    if (typeof name === "string") category.name = name;

    if (Number.isFinite(body.displayOrder)) category.displayOrder = Number(body.displayOrder);
    if (typeof body.isActive === "boolean") category.isActive = body.isActive;

    const tmpKey = asTrimmedString(body.tmpKey);
    tmpKeyToCleanup = tmpKey ?? null;
    if (tmpKey) {
      if (!tmpKey.startsWith("tmp/")) return res.status(400).json({ error: "tmpKey must start with tmp/" });
      const exists = await headObject(tmpKey);
      if (!exists) return res.status(400).json({ error: "Uploaded file not found on S3" });
      const fileSuffix = tmpKey.split("/").pop() ?? crypto.randomUUID();
      finalKey = `categories/${crypto.randomUUID()}-${fileSuffix}`;
      await copyObject({ fromKey: tmpKey, toKey: finalKey });
      category.thumbnailImage = s3KeyToPublicUrl(finalKey);
      await deleteObject(tmpKey);
      tmpKeyToCleanup = null;
    }

    const categoryBannerTmpKeys = Array.isArray(body.categoryBannerTmpKeys)
      ? body.categoryBannerTmpKeys
          .map((key) => asTrimmedString(key))
          .filter((key): key is string => Boolean(key))
      : [];
    if (categoryBannerTmpKeys.some((key) => !key.startsWith("tmp/"))) {
      return res.status(400).json({ error: "All categoryBannerTmpKeys must start with tmp/" });
    }

    if (categoryBannerTmpKeys.length > 0) {
      for (const bannerTmpKey of categoryBannerTmpKeys) {
        const exists = await headObject(bannerTmpKey);
        if (!exists) {
          return res.status(400).json({ error: "One or more category banner uploads are missing on S3" });
        }
        const bannerSuffix = bannerTmpKey.split("/").pop() ?? crypto.randomUUID();
        const bannerFinalKey = `categories/${crypto.randomUUID()}-${bannerSuffix}`;
        await copyObject({ fromKey: bannerTmpKey, toKey: bannerFinalKey });
        bannerFinalKeys.push(bannerFinalKey);
        bannerTmpKeysToCleanup.push(bannerTmpKey);
      }
      category.categoryBannerImages = bannerFinalKeys.map((key) => s3KeyToPublicUrl(key));
    }

    await category.save();

    for (const bannerTmpKey of bannerTmpKeysToCleanup) {
      await deleteObject(bannerTmpKey);
    }

    return res.status(200).json({ category });
  } catch {
    try {
      if (finalKey) await deleteObject(finalKey);
    } catch {
      // best-effort cleanup
    }
    if (tmpKeyToCleanup) {
      try {
        await deleteObject(tmpKeyToCleanup);
      } catch {
        // best-effort cleanup
      }
    }
    for (const key of bannerFinalKeys) {
      try {
        await deleteObject(key);
      } catch {
        // best-effort cleanup
      }
    }
    for (const key of bannerTmpKeysToCleanup) {
      try {
        await deleteObject(key);
      } catch {
        // best-effort cleanup
      }
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/categories/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = getSingleParamValue(req.params.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const hasSubcategories = await Subcategory.exists({ categoryId: id });
    if (hasSubcategories) {
      return res.status(409).json({ error: "Cannot delete category with subcategories" });
    }
    const hasProfiles = await SubcategoryProfile.exists({ categoryId: id });
    if (hasProfiles) {
      return res.status(409).json({ error: "Cannot delete category with subcategory profiles" });
    }

    const deleted = await Category.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Category not found" });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/subcategory-profiles", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const categoryId = asTrimmedString(req.query.categoryId);
    const query =
      categoryId && mongoose.Types.ObjectId.isValid(categoryId) ? { categoryId } : {};

    const subcategoryProfiles = await SubcategoryProfile.find(query).sort({
      displayOrder: 1,
      createdAt: -1,
    });

    return res.status(200).json({ subcategoryProfiles });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/subcategory-profiles", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body as {
      categoryId?: string;
      name?: string;
      displayOrder?: number;
      isActive?: boolean;
    };

    const categoryId = asTrimmedString(body.categoryId);
    const name = asTrimmedString(body.name);
    const displayOrder = Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0;
    const isActive = typeof body.isActive === "boolean" ? body.isActive : true;

    if (!categoryId) return res.status(400).json({ error: "categoryId is required" });
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: "Invalid categoryId" });
    }
    if (!name) return res.status(400).json({ error: "name is required" });

    const category = await Category.findById(categoryId).select("_id");
    if (!category) return res.status(404).json({ error: "Category not found" });

    const subcategoryProfile = await SubcategoryProfile.create({
      categoryId,
      name,
      displayOrder,
      isActive,
    });

    return res.status(201).json({ subcategoryProfile });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/subcategory-profiles/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = getSingleParamValue(req.params.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const body = req.body as {
      name?: string;
      displayOrder?: number;
      isActive?: boolean;
    };

    const profile = await SubcategoryProfile.findById(id);
    if (!profile) return res.status(404).json({ error: "Subcategory profile not found" });

    const name = asTrimmedString(body.name);
    if (typeof name === "string") profile.name = name;
    if (Number.isFinite(body.displayOrder)) profile.displayOrder = Number(body.displayOrder);
    if (typeof body.isActive === "boolean") profile.isActive = body.isActive;

    await profile.save();
    return res.status(200).json({ subcategoryProfile: profile });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/subcategory-profiles/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = getSingleParamValue(req.params.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const hasSubcategories = await Subcategory.exists({ subcategoryProfileId: id });
    if (hasSubcategories) {
      return res.status(409).json({ error: "Cannot delete subcategory profile with subcategories" });
    }

    const deleted = await SubcategoryProfile.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Subcategory profile not found" });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/subcategories", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const categoryId = asTrimmedString(req.query.categoryId);
    const subcategoryProfileId = asTrimmedString(req.query.subcategoryProfileId);

    if (subcategoryProfileId && !mongoose.Types.ObjectId.isValid(subcategoryProfileId)) {
      return res.status(400).json({ error: "Invalid subcategoryProfileId" });
    }

    const query: Record<string, unknown> = {};
    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) query.categoryId = categoryId;
    if (subcategoryProfileId && mongoose.Types.ObjectId.isValid(subcategoryProfileId)) {
      query.subcategoryProfileId = subcategoryProfileId;
    }

    const subcategories = await Subcategory.find(query).sort({ displayOrder: 1, createdAt: -1 });
    return res.status(200).json({ subcategories });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/subcategories", requireAuth, requireRole("admin"), async (req, res) => {
  let finalThumbnailKey: string | null = null;
  let thumbnailTmpKeyToCleanup: string | null = null;
  try {
    const body = req.body as {
      categoryId?: string;
      subcategoryProfileId?: string;
      name?: string;
      subtext?: string;
      description?: string;
      thumbnailTmpKey?: string;
      thumbnailImage?: string;
      displayOrder?: number;
      isActive?: boolean;
      isBestSeller?: boolean;
      isReadyToShip?: boolean;
      infoText?: string;
      specialNotePlaceholderText?: string;
      weightDisplay?: "pointer" | "carat" | "both";
      filterSchema?: unknown[];
    };

    const categoryId = asTrimmedString(body.categoryId);
    const subcategoryProfileId = asTrimmedString(body.subcategoryProfileId);
    const name = asTrimmedString(body.name);
    const subtext = asTrimmedString(body.subtext);
    const description = asTrimmedString(body.description);
    const thumbnailTmpKey = asTrimmedString(body.thumbnailTmpKey);
    thumbnailTmpKeyToCleanup = thumbnailTmpKey ?? null;
    const thumbnailImageFromClient = asTrimmedString(body.thumbnailImage);
    const infoText = asTrimmedString(body.infoText);
    const specialNotePlaceholderText = asTrimmedString(body.specialNotePlaceholderText);
    const displayOrder = Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0;
    const isActive = typeof body.isActive === "boolean" ? body.isActive : true;
    const isBestSeller = typeof body.isBestSeller === "boolean" ? body.isBestSeller : false;
    const isReadyToShip =
      typeof body.isReadyToShip === "boolean" ? body.isReadyToShip : false;
    const weightDisplay =
      body.weightDisplay === "pointer" ||
      body.weightDisplay === "carat" ||
      body.weightDisplay === "both"
        ? body.weightDisplay
        : "pointer";

    if (!categoryId) return res.status(400).json({ error: "categoryId is required" });
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: "Invalid categoryId" });
    }
    if (!name) return res.status(400).json({ error: "name is required" });
    if (subcategoryProfileId) {
      if (!mongoose.Types.ObjectId.isValid(subcategoryProfileId)) {
        return res.status(400).json({ error: "Invalid subcategoryProfileId" });
      }
      const subcategoryProfile = await SubcategoryProfile.findById(subcategoryProfileId).select(
        "_id categoryId",
      );
      if (!subcategoryProfile) return res.status(404).json({ error: "Subcategory profile not found" });
      if (String(subcategoryProfile.categoryId) !== categoryId) {
        return res
          .status(400)
          .json({ error: "Subcategory profile must belong to the selected category" });
      }
    }

    const category = await Category.findById(categoryId).select("_id");
    if (!category) return res.status(404).json({ error: "Category not found" });

    const filterSchema = Array.isArray(body.filterSchema)
      ? body.filterSchema
          .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
          .map((f) => ({
            key: String(f.key ?? "").trim(),
            label: String(f.label ?? "").trim(),
            type: (["chips", "multi_chips", "dropdown"] as const).includes(f.type as "chips" | "multi_chips" | "dropdown")
              ? (f.type as "chips" | "multi_chips" | "dropdown")
              : ("chips" as const),
            displayOrder: Number.isFinite(f.displayOrder) ? Number(f.displayOrder) : 0,
            options: Array.isArray(f.options)
              ? f.options
                  .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
                  .map((o) => ({
                    label: String(o.label ?? "").trim(),
                    value: String(o.value ?? "").trim(),
                  }))
                  .filter((o) => o.label && o.value)
              : [],
          }))
          .filter((f) => f.key && f.label)
      : [];

    let thumbnailImage: string | undefined = thumbnailImageFromClient;
    if (thumbnailTmpKey) {
      if (!thumbnailTmpKey.startsWith("tmp/")) {
        return res.status(400).json({ error: "thumbnailTmpKey must start with tmp/" });
      }
      const exists = await headObject(thumbnailTmpKey);
      if (!exists) return res.status(400).json({ error: "Uploaded file not found on S3" });

      const fileSuffix = thumbnailTmpKey.split("/").pop() ?? crypto.randomUUID();
      finalThumbnailKey = `subcategories/${crypto.randomUUID()}-${fileSuffix}`;
      await copyObject({ fromKey: thumbnailTmpKey, toKey: finalThumbnailKey });
      thumbnailImage = s3KeyToPublicUrl(finalThumbnailKey);

      await deleteObject(thumbnailTmpKey);
      thumbnailTmpKeyToCleanup = null;
    }

    const subcategory = await Subcategory.create({
      categoryId,
      subcategoryProfileId: subcategoryProfileId
        ? new mongoose.Types.ObjectId(subcategoryProfileId)
        : undefined,
      name,
      subtext,
      description,
      thumbnailImage,
      displayOrder,
      isActive,
      isBestSeller,
      isReadyToShip,
      productCount: 0,
      infoText,
      specialNotePlaceholderText,
      weightDisplay,
      filterSchema,
    });

    return res.status(201).json({ subcategory });
  } catch {
    try {
      if (finalThumbnailKey) await deleteObject(finalThumbnailKey);
    } catch {
      // best-effort cleanup
    }
    if (thumbnailTmpKeyToCleanup) {
      try {
        await deleteObject(thumbnailTmpKeyToCleanup);
      } catch {
        // best-effort cleanup
      }
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/subcategories/:id", requireAuth, requireRole("admin"), async (req, res) => {
  let finalThumbnailKey: string | null = null;
  let thumbnailTmpKeyToCleanup: string | null = null;
  try {
    const id = getSingleParamValue(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const body = req.body as {
      categoryId?: string;
      subcategoryProfileId?: string;
      name?: string;
      subtext?: string;
      description?: string;
      thumbnailTmpKey?: string;
      thumbnailImage?: string;
      displayOrder?: number;
      isActive?: boolean;
      isBestSeller?: boolean;
      isReadyToShip?: boolean;
      infoText?: string;
      specialNotePlaceholderText?: string;
      weightDisplay?: "pointer" | "carat" | "both";
      filterSchema?: unknown[];
    };

    const subcategory = await Subcategory.findById(id);
    if (!subcategory) return res.status(404).json({ error: "Not found" });

    const categoryId = asTrimmedString(body.categoryId);
    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ error: "Invalid categoryId" });
      }
      const category = await Category.findById(categoryId).select("_id");
      if (!category) return res.status(404).json({ error: "Category not found" });
      subcategory.categoryId = new mongoose.Types.ObjectId(categoryId);
    }

    const subcategoryProfileId = asTrimmedString(body.subcategoryProfileId);
    if (subcategoryProfileId) {
      if (!mongoose.Types.ObjectId.isValid(subcategoryProfileId)) {
        return res.status(400).json({ error: "Invalid subcategoryProfileId" });
      }
      const subcategoryProfile = await SubcategoryProfile.findById(subcategoryProfileId).select(
        "_id categoryId",
      );
      if (!subcategoryProfile) return res.status(404).json({ error: "Subcategory profile not found" });
      if (String(subcategoryProfile.categoryId) !== String(subcategory.categoryId)) {
        return res.status(400).json({ error: "Subcategory profile must belong to the selected category" });
      }
      subcategory.subcategoryProfileId = new mongoose.Types.ObjectId(subcategoryProfileId);
    }

    const name = asTrimmedString(body.name);
    if (typeof name === "string") subcategory.name = name;

    if (typeof body.subtext === "string") {
      subcategory.subtext = body.subtext.trim() || undefined;
    }
    if (typeof body.description === "string") {
      subcategory.description = body.description.trim() || undefined;
    }

    const thumbnailTmpKey = asTrimmedString(body.thumbnailTmpKey);
    thumbnailTmpKeyToCleanup = thumbnailTmpKey ?? null;
    const thumbnailImageFromClient = asTrimmedString(body.thumbnailImage);

    if (thumbnailTmpKey) {
      if (!thumbnailTmpKey.startsWith("tmp/")) {
        return res.status(400).json({ error: "thumbnailTmpKey must start with tmp/" });
      }
      const exists = await headObject(thumbnailTmpKey);
      if (!exists) return res.status(400).json({ error: "Uploaded file not found on S3" });

      const fileSuffix = thumbnailTmpKey.split("/").pop() ?? crypto.randomUUID();
      finalThumbnailKey = `subcategories/${crypto.randomUUID()}-${fileSuffix}`;
      await copyObject({ fromKey: thumbnailTmpKey, toKey: finalThumbnailKey });
      subcategory.thumbnailImage = s3KeyToPublicUrl(finalThumbnailKey);

      await deleteObject(thumbnailTmpKey);
      thumbnailTmpKeyToCleanup = null;
    } else if (typeof body.thumbnailImage === "string") {
      subcategory.thumbnailImage = thumbnailImageFromClient;
    }
    if (Number.isFinite(body.displayOrder)) {
      subcategory.displayOrder = Number(body.displayOrder);
    }
    if (typeof body.isActive === "boolean") subcategory.isActive = body.isActive;
    if (typeof body.isBestSeller === "boolean") subcategory.isBestSeller = body.isBestSeller;
    if (typeof body.isReadyToShip === "boolean") {
      subcategory.isReadyToShip = body.isReadyToShip;
    }
    if (typeof body.infoText === "string") {
      subcategory.infoText = body.infoText.trim() || undefined;
    }
    if (typeof body.specialNotePlaceholderText === "string") {
      subcategory.specialNotePlaceholderText = body.specialNotePlaceholderText.trim() || undefined;
    }
    if (
      body.weightDisplay === "pointer" ||
      body.weightDisplay === "carat" ||
      body.weightDisplay === "both"
    ) {
      subcategory.weightDisplay = body.weightDisplay;
    }

    if (Array.isArray(body.filterSchema)) {
      subcategory.filterSchema = body.filterSchema
        .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
        .map((f) => ({
          key: String(f.key ?? "").trim(),
          label: String(f.label ?? "").trim(),
          type: (["chips", "multi_chips", "dropdown"] as const).includes(f.type as "chips" | "multi_chips" | "dropdown")
            ? (f.type as "chips" | "multi_chips" | "dropdown")
            : ("chips" as const),
          displayOrder: Number.isFinite(f.displayOrder) ? Number(f.displayOrder) : 0,
          options: Array.isArray(f.options)
            ? f.options
                .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
                .map((o) => ({
                  label: String(o.label ?? "").trim(),
                  value: String(o.value ?? "").trim(),
                }))
                .filter((o) => o.label && o.value)
            : [],
        }))
        .filter((f) => f.key && f.label);
    }

    // Keep productCount read-only in admin.
    subcategory.productCount = Number.isFinite(subcategory.productCount)
      ? subcategory.productCount
      : 0;

    await subcategory.save();
    return res.status(200).json({ subcategory });
  } catch {
    try {
      if (finalThumbnailKey) await deleteObject(finalThumbnailKey);
    } catch {
      // best-effort cleanup
    }
    if (thumbnailTmpKeyToCleanup) {
      try {
        await deleteObject(thumbnailTmpKeyToCleanup);
      } catch {
        // best-effort cleanup
      }
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/subcategories/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = getSingleParamValue(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const deleted = await Subcategory.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Not found" });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/products", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const categoryId = asTrimmedString(req.query.categoryId);
    const subcategoryId = asTrimmedString(req.query.subcategoryId);
    const query: Record<string, unknown> = {};

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ error: "Invalid categoryId" });
      }
      query.categoryId = categoryId;
    }

    if (subcategoryId) {
      if (!mongoose.Types.ObjectId.isValid(subcategoryId)) {
        return res.status(400).json({ error: "Invalid subcategoryId" });
      }
      query.subcategoryId = subcategoryId;
    }

    const products = await Product.find(query).sort({ displayOrder: 1, createdAt: -1 });
    return res.status(200).json({ products });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/products", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const parsed = parseAdminProductBody(req.body as Record<string, unknown>);
    if (!parsed) {
      return res.status(400).json({ error: "styleNo, categoryId, and subcategoryId are required" });
    }
    parsed.filter = await normalizeFilterPayloadForRingCategory(parsed.categoryId, parsed.filter ?? []);
    const result = await createAdminProduct(parsed);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(201).json({ product: result.product });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/** Excel bulk product import — implemented on chandra_backend only (not the legacy `backend/` app). */
router.post(
  "/products/bulk-upload",
  requireAuth,
  requireRole("admin"),
  bulkUpload.single("file"),
  async (req, res) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ error: "Excel file is required (form field name: file)" });
      }

      const rows = parseBulkExcelBuffer(req.file.buffer);
      const errors: Array<{ row: number; styleNo?: string; error: string }> = [];
      let created = 0;

      const grouped = groupBulkRowsIntoStyleGroups(rows);
      if (!grouped.ok) {
        return res.status(400).json({ error: grouped.error, row: grouped.excelRow });
      }

      for (const group of grouped.groups) {
        const first = group.rows[0];
        const categoryName = cellToString(first.category);
        const subcategoryName = cellToString(first.subcategory);
        const profileName = cellToString(first.subcategoryProfile);

        const resolved = await resolveHierarchyByNames({
          categoryName,
          subcategoryProfileName: profileName || undefined,
          subcategoryName,
        });
        if (!resolved.ok) {
          errors.push({
            row: group.excelStartRow,
            styleNo: group.styleNo,
            error: resolved.error,
          });
          continue;
        }

        const sub = await Subcategory.findById(resolved.subcategoryId).select("filterSchema").lean();
        const runtimeFilterSchema = await buildRingFilterSchema(
          sub?.filterSchema ?? [],
          resolved.categoryId,
        );
        const built = bulkProductGroupToAdminInput(group, resolved, runtimeFilterSchema);
        if (!built.ok) {
          errors.push({
            row: group.excelStartRow,
            styleNo: group.styleNo,
            error: built.error,
          });
          continue;
        }

        built.input.filter = await normalizeFilterPayloadForRingCategory(
          resolved.categoryId,
          built.input.filter ?? [],
        );

        const result = await createAdminProduct(built.input);
        if (!result.ok) {
          errors.push({
            row: group.excelStartRow,
            styleNo: group.styleNo,
            error: result.error,
          });
        } else {
          created += 1;
        }
      }

      return res.status(200).json({ created, errors });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  },
);

router.put("/products/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = getSingleParamValue(req.params.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const body = req.body as {
      styleNo?: string;
      categoryId?: string;
      subcategoryProfileId?: string;
      subcategoryId?: string;
      makeType?: string;
      description?: string;
      remarks?: string;
      diamonds?: unknown[];
      totalDiamondPcs?: number;
      totalDiamondWeightCt?: number;
      pointer?: number;
      metalWeights?: Record<string, unknown>;
      embedding?: unknown[];
      images?: unknown[];
      displayOrder?: number;
      isActive?: boolean;
      isBestSeller?: boolean;
      isReadyToShip?: boolean;
      filter?: unknown[];
    };

    const styleNo = asTrimmedString(body.styleNo);
    const categoryId = asTrimmedString(body.categoryId);
    const subcategoryProfileId = asTrimmedString(body.subcategoryProfileId);
    const subcategoryId = asTrimmedString(body.subcategoryId);
    const makeType = asTrimmedString(body.makeType);
    const description = asTrimmedString(body.description);
    const remarks = asTrimmedString(body.remarks);
    const totalDiamondPcs =
      Number.isFinite(body.totalDiamondPcs) ? Number(body.totalDiamondPcs) : 0;
    const totalDiamondWeightCt =
      Number.isFinite(body.totalDiamondWeightCt) ? Number(body.totalDiamondWeightCt) : 0;
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
      ? body.embedding.map((value) => Number(value)).filter((value) => Number.isFinite(value))
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
      typeof body.metalWeights === "object" && body.metalWeights !== null
        ? body.metalWeights
        : {};
    function parseMetalWeightEntry(rawEntry: unknown, fallbackLabel: string) {
      if (Number.isFinite(rawEntry)) {
        return { label: fallbackLabel, value: Number(rawEntry) };
      }
      if (typeof rawEntry !== "object" || rawEntry === null) return undefined;
      const entry = rawEntry as Record<string, unknown>;
      const label = asTrimmedString(entry.label) ?? fallbackLabel;
      const value = Number.isFinite(entry.value) ? Number(entry.value) : undefined;
      if (!label && value === undefined) return undefined;
      return { label, value };
    }
    const metalWeights = {
      gold10K: parseMetalWeightEntry(rawMetalWeights.gold10K, "Gold 10K"),
      gold14K: parseMetalWeightEntry(rawMetalWeights.gold14K, "Gold 14K"),
      gold18K: parseMetalWeightEntry(rawMetalWeights.gold18K, "Gold 18K"),
      silver: parseMetalWeightEntry(rawMetalWeights.silver, "Silver"),
      platinum: parseMetalWeightEntry(rawMetalWeights.platinum, "Platinum"),
    };
    const parsedFilter = Array.isArray(body.filter)
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

    if (!styleNo) return res.status(400).json({ error: "styleNo is required" });
    if (!categoryId) return res.status(400).json({ error: "categoryId is required" });
    if (!subcategoryId) return res.status(400).json({ error: "subcategoryId is required" });
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: "Invalid categoryId" });
    }
    if (!mongoose.Types.ObjectId.isValid(subcategoryId)) {
      return res.status(400).json({ error: "Invalid subcategoryId" });
    }
    if (subcategoryProfileId && !mongoose.Types.ObjectId.isValid(subcategoryProfileId)) {
      return res.status(400).json({ error: "Invalid subcategoryProfileId" });
    }

    const existing = await Product.findById(id);
    if (!existing) return res.status(404).json({ error: "Product not found" });

    const styleConflict = await Product.findOne({ styleNo, _id: { $ne: id } }).select("_id");
    if (styleConflict) return res.status(409).json({ error: "styleNo already exists" });

    const category = await Category.findById(categoryId).select("_id");
    if (!category) return res.status(404).json({ error: "Category not found" });
    if (subcategoryProfileId) {
      const subcategoryProfile = await SubcategoryProfile.findById(subcategoryProfileId).select(
        "_id categoryId",
      );
      if (!subcategoryProfile) return res.status(404).json({ error: "Subcategory profile not found" });
      if (String(subcategoryProfile.categoryId) !== categoryId) {
        return res.status(400).json({ error: "Subcategory profile must belong to selected category" });
      }
    }
    const subcategory = await Subcategory.findById(subcategoryId).select(
      "_id categoryId subcategoryProfileId",
    );
    if (!subcategory) return res.status(404).json({ error: "Subcategory not found" });
    if (String(subcategory.categoryId) !== categoryId) {
      return res.status(400).json({ error: "Subcategory must belong to selected category" });
    }
    if (subcategoryProfileId) {
      if (String(subcategory.subcategoryProfileId ?? "") !== subcategoryProfileId) {
        return res
          .status(400)
          .json({ error: "Subcategory must belong to selected subcategory profile" });
      }
    } else if (subcategory.subcategoryProfileId) {
      return res
        .status(400)
        .json({ error: "Subcategory profile is required for this subcategory" });
    }

    const previousCategoryId = String(existing.categoryId);
    const previousSubcategoryId = String(existing.subcategoryId);

    existing.styleNo = styleNo;
    existing.categoryId = new mongoose.Types.ObjectId(categoryId);
    existing.subcategoryProfileId = subcategoryProfileId
      ? new mongoose.Types.ObjectId(subcategoryProfileId)
      : undefined;
    existing.subcategoryId = new mongoose.Types.ObjectId(subcategoryId);
    existing.makeType = makeType;
    existing.description = description;
    existing.remarks = remarks;
    existing.diamonds = diamonds;
    existing.totalDiamondPcs = totalDiamondPcs;
    existing.totalDiamondWeightCt = totalDiamondWeightCt;
    existing.pointer = pointer;
    existing.metalWeights = metalWeights;
    existing.images = images;
    existing.embedding = embedding;
    existing.displayOrder = displayOrder;
    existing.isActive = isActive;
    existing.isBestSeller = isBestSeller;
    existing.isReadyToShip = isReadyToShip;
    existing.filter = await normalizeFilterPayloadForRingCategory(categoryId, parsedFilter);
    await existing.save();

    if (previousCategoryId !== categoryId) {
      await Category.updateOne({ _id: previousCategoryId }, { $inc: { productCount: -1 } });
      await Category.updateOne({ _id: categoryId }, { $inc: { productCount: 1 } });
    }
    if (previousSubcategoryId !== subcategoryId) {
      await Subcategory.updateOne({ _id: previousSubcategoryId }, { $inc: { productCount: -1 } });
      await Subcategory.updateOne({ _id: subcategoryId }, { $inc: { productCount: 1 } });
    }

    return res.status(200).json({ product: existing });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/products/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = getSingleParamValue(req.params.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const product = await Product.findByIdAndDelete(id).select("_id categoryId subcategoryId");
    if (!product) return res.status(404).json({ error: "Product not found" });

    await Category.updateOne({ _id: product.categoryId }, { $inc: { productCount: -1 } });
    await Subcategory.updateOne({ _id: product.subcategoryId }, { $inc: { productCount: -1 } });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
