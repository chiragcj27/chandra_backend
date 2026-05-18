import mongoose from "mongoose";

import { Category } from "../models/Category";
import { Product } from "../models/Product";
import { Subcategory } from "../models/Subcategory";
import { SubcategoryProfile } from "../models/SubcategoryProfile";

export type HighlightSubcategoryCard = {
  _id: string;
  name: string;
  imageUrl: string;
  subtext: string;
  description: string;
  infoText: string;
  designCount: number;
  categoryId: string;
  categoryName: string;
  subcategoryProfileId?: string;
  subcategoryProfileName?: string;
  filterSchema: unknown[];
  images: string[];
  specialNotePlaceholderText: string;
};

type ProductHighlightFlag = "isBestSeller" | "isReadyToShip";

export async function getHighlightSubcategories(
  flag: ProductHighlightFlag,
): Promise<HighlightSubcategoryCard[]> {
  const subcategoryIds = await Product.distinct("subcategoryId", {
    isActive: true,
    [flag]: true,
  });

  if (!subcategoryIds.length) return [];

  const subcategories = await Subcategory.find({
    _id: { $in: subcategoryIds },
    isActive: true,
  }).sort({ displayOrder: 1, createdAt: -1 });

  if (!subcategories.length) return [];

  const categoryIds = [...new Set(subcategories.map((s) => String(s.categoryId)))];
  const categories = await Category.find({ _id: { $in: categoryIds }, isActive: true }).select(
    "_id name",
  );
  const categoryNameById = new Map(categories.map((c) => [String(c._id), c.name]));

  const profileIds = subcategories
    .map((s) => s.subcategoryProfileId)
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const profiles = profileIds.length
    ? await SubcategoryProfile.find({ _id: { $in: profileIds } }).select("_id name")
    : [];
  const profileNameById = new Map(profiles.map((p) => [String(p._id), p.name]));

  const counts = await Product.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    {
      $match: {
        isActive: true,
        [flag]: true,
        subcategoryId: { $in: subcategories.map((s) => s._id) },
      },
    },
    { $group: { _id: "$subcategoryId", count: { $sum: 1 } } },
  ]);
  const countBySubcategoryId = new Map(counts.map((row) => [String(row._id), row.count]));

  return subcategories
    .filter((s) => categoryNameById.has(String(s.categoryId)))
    .map((s) => {
      const customSubtext = String(s.subtext || "").trim();
      const matchingCount = countBySubcategoryId.get(String(s._id)) ?? 0;
      const profileId = s.subcategoryProfileId ? String(s.subcategoryProfileId) : undefined;

      return {
        _id: String(s._id),
        name: s.name,
        imageUrl: s.thumbnailImage ?? "",
        subtext: customSubtext || `${matchingCount} Designs`,
        description: s.description ?? "",
        infoText: s.infoText ?? "",
        designCount: matchingCount,
        categoryId: String(s.categoryId),
        categoryName: categoryNameById.get(String(s.categoryId)) ?? "",
        subcategoryProfileId: profileId,
        subcategoryProfileName: profileId ? profileNameById.get(profileId) : undefined,
        filterSchema: s.filterSchema ?? [],
        images: s.images ?? [],
        specialNotePlaceholderText: s.specialNotePlaceholderText ?? "Length variation",
      };
    });
}
