import { Category } from "../../models/Category";
import { Subcategory } from "../../models/Subcategory";
import { SubcategoryProfile } from "../../models/SubcategoryProfile";

const CATALOG_CONTEXT_CACHE_TTL_MS = 2 * 60 * 1000;
let cachedCatalogContext: { categories: BulkOrderCatalogCategory[] } | null = null;
let catalogContextCachedAt = 0;
let catalogContextInFlight: Promise<{ categories: BulkOrderCatalogCategory[] }> | null = null;

export type BulkOrderCatalogFilter = {
  name: string;
  type: "chips" | "multi_chips" | "dropdown";
  values: string[];
};

export type BulkOrderCatalogSubcategory = {
  id: string;
  name: string;
  filters: BulkOrderCatalogFilter[];
};

export type BulkOrderCatalogProfile = {
  id: string;
  name: string;
  subcategories: BulkOrderCatalogSubcategory[];
};

export type BulkOrderCatalogCategory = {
  id: string;
  name: string;
  profiles: BulkOrderCatalogProfile[];
};

export function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function fetchBulkOrderCatalogContext(): Promise<{ categories: BulkOrderCatalogCategory[] }> {
  const startedAt = Date.now();
  console.log("[BulkOrderCatalogContext] building context");
  const [categories, profiles, subcategories] = await Promise.all([
    Category.find({ isActive: true }).sort({ displayOrder: 1, createdAt: -1 }).select("_id name").lean(),
    SubcategoryProfile.find({ isActive: true })
      .sort({ displayOrder: 1, createdAt: -1 })
      .select("_id categoryId name")
      .lean(),
    Subcategory.find({ isActive: true })
      .sort({ displayOrder: 1, createdAt: -1 })
      .select("_id categoryId subcategoryProfileId name filterSchema")
      .lean(),
  ]);

  const profilesByCategory = new Map<string, Array<{ _id: unknown; name: string }>>();
  for (const p of profiles) {
    const cid = String(p.categoryId || "");
    if (!cid) continue;
    const list = profilesByCategory.get(cid) || [];
    list.push({ _id: p._id, name: String(p.name || "") });
    profilesByCategory.set(cid, list);
  }

  const subcategoriesByProfile = new Map<string, BulkOrderCatalogSubcategory[]>();
  for (const s of subcategories) {
    const profileId = String(s.subcategoryProfileId || "");
    if (!profileId) continue;
    const filters = Array.isArray(s.filterSchema)
      ? s.filterSchema.map((f) => ({
          name: String(f.label || f.key || "").trim(),
          type: f.type || "chips",
          values: Array.isArray(f.options) ? f.options.map((o) => String(o.value || o.label || "").trim()).filter(Boolean) : [],
        }))
      : [];

    const list = subcategoriesByProfile.get(profileId) || [];
    list.push({
      id: String(s._id),
      name: String(s.name || ""),
      filters,
    });
    subcategoriesByProfile.set(profileId, list);
  }

  const payload: BulkOrderCatalogCategory[] = categories.map((c) => {
    const cid = String(c._id);
    const mappedProfiles = (profilesByCategory.get(cid) || [])
      .map((p) => ({
        id: String(p._id),
        name: p.name,
        subcategories: subcategoriesByProfile.get(String(p._id)) || [],
      }))
      .filter((profile) => profile.subcategories.length > 0);

    return {
      id: cid,
      name: String(c.name || ""),
      profiles: mappedProfiles,
    };
  });

  const filtered = payload.filter((c) => c.profiles.length > 0);
  console.log("[BulkOrderCatalogContext] context built", {
    categoriesFetched: categories.length,
    profilesFetched: profiles.length,
    subcategoriesFetched: subcategories.length,
    categoriesReturned: filtered.length,
    elapsedMs: Date.now() - startedAt,
  });
  return { categories: filtered };
}

export async function buildBulkOrderCatalogContext(): Promise<{ categories: BulkOrderCatalogCategory[] }> {
  const age = Date.now() - catalogContextCachedAt;
  if (cachedCatalogContext && age < CATALOG_CONTEXT_CACHE_TTL_MS) {
    return cachedCatalogContext;
  }

  if (catalogContextInFlight) {
    return catalogContextInFlight;
  }

  catalogContextInFlight = fetchBulkOrderCatalogContext()
    .then((context) => {
      cachedCatalogContext = context;
      catalogContextCachedAt = Date.now();
      return context;
    })
    .finally(() => {
      catalogContextInFlight = null;
    });

  return catalogContextInFlight;
}
