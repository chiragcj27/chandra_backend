import { Router } from "express";
import mongoose from "mongoose";

import { Category } from "../models/Category";
import { Product } from "../models/Product";
import { Subcategory, type FilterField } from "../models/Subcategory";
import { SubcategoryProfile } from "../models/SubcategoryProfile";

const router = Router();

/** Profile groups in /categories/:id/subcategory-profiles; legacy bucket uses a string _id sentinel. */
type SubcategoryProfileGroup = {
  _id: mongoose.Types.ObjectId | string;
  name: string;
  subcategories: Array<{
    _id: mongoose.Types.ObjectId;
    name: string;
    imageUrl: string;
    thumbnailImage: string;
    images: string[];
    description: string;
    subtext: string;
    designCount: number;
    infoText: string;
    filterSchema: FilterField[];
  }>;
};

/** Public endpoint – returns only active categories ordered by displayOrder. */
router.get("/categories", async (_req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ displayOrder: 1, createdAt: -1 })
      .select("_id name thumbnailImage categoryBannerImages productCount");

    const payload = categories.map((c) => ({
      _id: c._id,
      name: c.name,
      imageUrl: c.thumbnailImage ?? "",
      categoryBannerImages: c.categoryBannerImages ?? [],
      designCount: c.productCount,
    }));

    return res.status(200).json({ categories: payload });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * Public endpoint – returns subcategory profiles for a category, with their subcategories.
 * It also includes legacy subcategories (without a profile) as a separate section.
 * Used by the mobile app category page to render all available subcategory groups.
 */
router.get("/categories/:categoryId/subcategory-profiles", async (req, res) => {
  try {
    const categoryId = req.params.categoryId;
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: "Invalid categoryId" });
    }

    const category = await Category.findOne({ _id: categoryId, isActive: true }).select(
      "_id name",
    );
    if (!category) return res.status(404).json({ error: "Category not found" });

    const profiles = await SubcategoryProfile.find({ categoryId, isActive: true }).sort({
      displayOrder: 1,
      createdAt: -1,
    });

    const subcategories = await Subcategory.find({
      categoryId,
      isActive: true,
    }).sort({ displayOrder: 1, createdAt: -1 });

    const byProfileId = new Map<string, typeof subcategories>();
    const legacySubcategories: typeof subcategories = [];
    for (const s of subcategories) {
      const pid = s.subcategoryProfileId?.toString();
      if (!pid) {
        legacySubcategories.push(s);
        continue;
      }
      const existing = byProfileId.get(pid);
      if (existing) existing.push(s);
      else byProfileId.set(pid, [s]);
    }

    const payload: SubcategoryProfileGroup[] = profiles
      .map((p) => ({
        _id: p._id,
        name: p.name,
        subcategories: (byProfileId.get(p._id.toString()) ?? []).map((s) => ({
          _id: s._id,
          name: s.name,
          imageUrl: s.thumbnailImage ?? "",
          thumbnailImage: s.thumbnailImage ?? "",
          images: s.images ?? [],
          description: s.description ?? "",
          subtext: s.subtext ?? "",
          designCount: s.productCount ?? 0,
          infoText: s.infoText ?? "",
          filterSchema: s.filterSchema ?? [],
        })),
      }))
      .filter((profile) => profile.subcategories.length > 0);

    if (legacySubcategories.length > 0) {
      payload.push({
        _id: `legacy-${category._id.toString()}`,
        name: category.name,
        subcategories: legacySubcategories.map((s) => ({
          _id: s._id,
          name: s.name,
          imageUrl: s.thumbnailImage ?? "",
          thumbnailImage: s.thumbnailImage ?? "",
          images: s.images ?? [],
          description: s.description ?? "",
          subtext: s.subtext ?? "",
          designCount: s.productCount ?? 0,
          infoText: s.infoText ?? "",
          filterSchema: s.filterSchema ?? [],
        })),
      });
    }

    return res.status(200).json({ subcategoryProfiles: payload });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/** Public endpoint – returns active products for a subcategory. */
router.get("/subcategories/:subcategoryId/products", async (req, res) => {
  try {
    const subcategoryId = req.params.subcategoryId;
    if (!mongoose.Types.ObjectId.isValid(subcategoryId)) {
      return res.status(400).json({ error: "Invalid subcategoryId" });
    }

    const products = await Product.find({ subcategoryId, isActive: true })
      .sort({ displayOrder: 1, createdAt: -1 })
      .select(
        "_id styleNo makeType description remarks images isReadyToShip isBestSeller totalDiamondPcs totalDiamondWeightCt pointer metalWeights diamonds filter",
      );

    return res.status(200).json({ products });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
