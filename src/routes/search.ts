import { Router } from "express";
import pluralize from "pluralize";
import { Category } from "../models/Category";
import { Subcategory } from "../models/Subcategory";
import { SubcategoryProfile } from "../models/SubcategoryProfile";
import { Product } from "../models/Product";

const router = Router();

/** Escapes special regex characters so raw user input is safe to query. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Expands a word to its singular and plural forms so "necklace" and
 * "necklaces" match the same documents regardless of which form is stored
 * (e.g. a Category named "Necklace" vs. a filter tag stored as "Necklaces").
 * Plain substring matching alone is asymmetric here: "necklace" is a
 * substring of "Necklaces", but "necklaces" is not a substring of "Necklace".
 */
function wordVariants(word: string): string[] {
  return [...new Set([word, pluralize.singular(word), pluralize.plural(word)])];
}

/**
 * ANY-word query — at least one word must appear in any of the given fields.
 * Used for subcategories and products where a query can mix categorical terms
 * ("rings") with attribute/filter terms ("round"). Requiring ALL words would
 * return nothing because "round" never appears in a subcategory name.
 *   "round rings" → finds "Solitaire Rings" (matches "rings") ✓
 */
function buildAnyWordQuery(
  fields: string[],
  words: string[]
): Record<string, unknown> {
  const conditions = words.map((word) => {
    const alternation = wordVariants(word).map(escapeRegex).join("|");
    const re = new RegExp(alternation, "i");
    if (fields.length === 1) return { [fields[0]]: re };
    return { $or: fields.map((f) => ({ [f]: re })) };
  });
  return conditions.length === 1 ? conditions[0] : { $or: conditions };
}

/** Splits raw input into non-empty words. */
function parseWords(q: string): string[] {
  return q.trim().split(/\s+/).filter((w) => w.length > 0);
}

const RESULTS_PER_TYPE = 8;

/**
 * GET /search?q=<query>
 *
 * Searches across Categories, SubcategoryProfiles, Subcategories, and Products.
 * Returns up to RESULTS_PER_TYPE matches per type.
 *
 * Response shape:
 * {
 *   categories:         CategoryResult[],
 *   subcategoryProfiles: ProfileResult[],
 *   subcategories:      SubcategoryResult[],
 *   products:           ProductResult[],
 * }
 */
router.get("/search", async (req, res) => {
  try {
    const raw = String(req.query.q ?? "").trim();

    if (raw.length < 2) {
      return res.status(200).json({
        categories: [],
        subcategoryProfiles: [],
        subcategories: [],
        products: [],
      });
    }

    const words = parseWords(raw);

    // ── 1. Parallel first-pass queries (no populate needed yet) ─────────────
    const [categoryDocs, profileDocs, subcategoryDocs, productDocs] = await Promise.all([
      // Categories: any word must appear in name
      Category.find({ isActive: true, ...buildAnyWordQuery(["name"], words) })
        .sort({ displayOrder: 1, createdAt: -1 })
        .limit(RESULTS_PER_TYPE)
        .select("_id name thumbnailImage categoryBannerImages productCount"),

      // SubcategoryProfiles: any word must appear in name
      SubcategoryProfile.find({ isActive: true, ...buildAnyWordQuery(["name"], words) })
        .sort({ displayOrder: 1, createdAt: -1 })
        .limit(RESULTS_PER_TYPE)
        .select("_id name categoryId"),

      // Subcategories: ANY word must appear in name, subtext, or description.
      // Using any-word so "round rings" still finds "Solitaire Rings" even though
      // "round" does not appear in its name.
      Subcategory.find({
        isActive: true,
        ...buildAnyWordQuery(["name", "subtext", "description"], words),
      })
        .sort({ displayOrder: 1, createdAt: -1 })
        .limit(RESULTS_PER_TYPE)
        .select(
          "_id name thumbnailImage images categoryId subcategoryProfileId " +
          "subtext description infoText filterSchema productCount specialNotePlaceholderText"
        ),

      // Products: ANY word must appear in styleNo, name, or any filter value.
      // "round rings" → matches products whose filterValue contains "Round"
      // even though no product name contains "rings".
      Product.find({
        isActive: true,
        ...buildAnyWordQuery(["styleNo", "name", "filter.filterValue"], words),
      })
        .sort({ displayOrder: 1, createdAt: -1 })
        .limit(RESULTS_PER_TYPE)
        .select(
          "_id styleNo name displayImage images pointer totalDiamondWeightCt filter " +
          "subcategoryId subcategoryProfileId categoryId"
        ),
    ]);

    // ── 2. Collect IDs needed for enrichment ────────────────────────────────
    const profileCategoryIds = [...new Set(profileDocs.map((p) => p.categoryId.toString()))];

    const subcatCategoryIds = [...new Set(subcategoryDocs.map((s) => s.categoryId.toString()))];
    const subcatProfileIds = subcategoryDocs
      .filter((s) => s.subcategoryProfileId)
      .map((s) => s.subcategoryProfileId!.toString());

    const productSubcategoryIds = [...new Set(productDocs.map((p) => p.subcategoryId.toString()))];
    const productCategoryIds    = [...new Set(productDocs.map((p) => p.categoryId.toString()))];
    const productProfileIds     = productDocs
      .filter((p) => p.subcategoryProfileId)
      .map((p) => p.subcategoryProfileId!.toString());

    // ── 3. Parallel enrichment lookups ──────────────────────────────────────
    const [
      profileCategoryDocs,
      subcatCategoryDocs,
      subcatProfileDocs,
      productSubcategoryDocs,
      productCategoryDocs,
      productProfileDocs,
    ] = await Promise.all([
      // For profiles → need parent category (name + image + banners)
      Category.find({ _id: { $in: profileCategoryIds } }).select(
        "_id name thumbnailImage categoryBannerImages"
      ),

      // For subcategories → need parent category name
      Category.find({ _id: { $in: subcatCategoryIds } }).select("_id name"),

      // For subcategories → need parent profile name
      SubcategoryProfile.find({ _id: { $in: subcatProfileIds } }).select("_id name"),

      // For products → need full subcategory for nav params
      Subcategory.find({ _id: { $in: productSubcategoryIds } }).select(
        "_id name thumbnailImage images filterSchema description subtext infoText specialNotePlaceholderText"
      ),

      // For products → need category name
      Category.find({ _id: { $in: productCategoryIds } }).select("_id name"),

      // For products → need profile name
      SubcategoryProfile.find({ _id: { $in: productProfileIds } }).select("_id name"),
    ]);

    // ── 4. Build lookup maps ────────────────────────────────────────────────
    const profileCategoryMap = new Map(
      profileCategoryDocs.map((c) => [c._id.toString(), c])
    );
    const subcatCategoryMap = new Map(
      subcatCategoryDocs.map((c) => [c._id.toString(), c.name])
    );
    const subcatProfileMap = new Map(
      subcatProfileDocs.map((p) => [p._id.toString(), p.name])
    );
    const productSubcatMap = new Map(
      productSubcategoryDocs.map((s) => [s._id.toString(), s])
    );
    const productCategoryMap = new Map(
      productCategoryDocs.map((c) => [c._id.toString(), c.name])
    );
    const productProfileMap = new Map(
      productProfileDocs.map((p) => [p._id.toString(), p.name])
    );

    // ── 5. Shape response payloads ──────────────────────────────────────────

    const categories = categoryDocs.map((c) => ({
      _id: c._id,
      name: c.name,
      imageUrl: c.thumbnailImage ?? "",
      categoryBannerImages: c.categoryBannerImages ?? [],
      designCount: c.productCount ?? 0,
    }));

    const subcategoryProfiles = profileDocs.map((p) => {
      const cat = profileCategoryMap.get(p.categoryId.toString());
      return {
        _id: p._id,
        name: p.name,
        // category context — needed for navigation to CategoryDetails
        categoryId: p.categoryId,
        categoryName: cat?.name ?? "",
        imageUrl: cat?.thumbnailImage ?? "",
        categoryBannerImages: cat?.categoryBannerImages ?? [],
      };
    });

    const subcategories = subcategoryDocs.map((s) => ({
      _id: s._id,
      name: s.name,
      imageUrl: s.thumbnailImage ?? "",
      thumbnailImage: s.thumbnailImage ?? "",
      images: s.images ?? [],
      // parent context
      categoryId: s.categoryId,
      categoryName: subcatCategoryMap.get(s.categoryId.toString()) ?? "",
      subcategoryProfileId: s.subcategoryProfileId ?? null,
      subcategoryProfileName: s.subcategoryProfileId
        ? (subcatProfileMap.get(s.subcategoryProfileId.toString()) ?? "")
        : "",
      // nav params
      subtext: s.subtext ?? "",
      description: s.description ?? "",
      infoText: s.infoText ?? "",
      filterSchema: s.filterSchema ?? [],
      designCount: s.productCount ?? 0,
      specialNotePlaceholderText: s.specialNotePlaceholderText ?? "Length variation",
    }));

    const products = productDocs.map((p) => {
      const subcat = productSubcatMap.get(p.subcategoryId.toString());
      return {
        _id: p._id,
        styleNo: p.styleNo,
        name: p.name ?? "",
        displayImage: p.displayImage ?? p.images?.[0] ?? "",
        pointer: p.pointer ?? 0,
        totalDiamondWeightCt: p.totalDiamondWeightCt ?? 0,
        filter: p.filter ?? [],
        // subcategory context (full nav params so frontend doesn't need another fetch)
        subcategoryId: p.subcategoryId,
        subcategoryName: subcat?.name ?? "",
        subcategoryThumbnailImage: subcat?.thumbnailImage ?? "",
        subcategoryImages: subcat?.images ?? [],
        subcategoryFilterSchema: subcat?.filterSchema ?? [],
        subcategoryDescription: subcat?.description ?? "",
        subcategorySubtext: subcat?.subtext ?? "",
        specialNotePlaceholderText: subcat?.specialNotePlaceholderText ?? "Length variation",
        // profile + category context
        subcategoryProfileId: p.subcategoryProfileId ?? null,
        subcategoryProfileName: p.subcategoryProfileId
          ? (productProfileMap.get(p.subcategoryProfileId.toString()) ?? "")
          : "",
        categoryId: p.categoryId,
        categoryName: productCategoryMap.get(p.categoryId.toString()) ?? "",
      };
    });

    return res.status(200).json({ categories, subcategoryProfiles, subcategories, products });
  } catch (err) {
    console.error("[Search]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
