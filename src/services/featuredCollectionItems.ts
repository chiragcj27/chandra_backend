import mongoose from "mongoose";

import { Category } from "../models/Category";
import {
  FeaturedCollection,
  type FeaturedCollectionDocument,
  type FeaturedCollectionItem,
} from "../models/FeaturedCollection";
import { Product } from "../models/Product";
import { Subcategory } from "../models/Subcategory";
import { SubcategoryProfile } from "../models/SubcategoryProfile";

export type ResolvedCollectionSubcategoryItem = {
  itemId: string;
  type: "subcategory";
  subcategoryId: string;
  categoryId: string;
  categoryName: string;
  subcategoryProfileId?: string;
  subcategoryProfileName?: string;
  name: string;
  imageUrl: string;
  subtext: string;
  designCount: number;
  infoText: string;
  description: string;
  filterSchema: unknown[];
};

export type ResolvedCollectionProductItem = {
  itemId: string;
  type: "product";
  productId: string;
  styleNo: string;
  name: string;
  imageUrl: string;
  categoryId: string;
  categoryName: string;
  subcategoryId: string;
  subcategoryName: string;
  subcategoryProfileId?: string;
  subcategoryProfileName?: string;
};

export type ResolvedFeaturedCollection = {
  _id: string;
  name: string;
  description: string;
  bannerImageUrl: string;
  displayOrder: number;
  items: Array<ResolvedCollectionSubcategoryItem | ResolvedCollectionProductItem>;
};

function sortItems(items: FeaturedCollectionItem[]): FeaturedCollectionItem[] {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder || String(a._id).localeCompare(String(b._id)));
}

export async function resolveFeaturedCollectionItems(
  collection: FeaturedCollectionDocument,
): Promise<Array<ResolvedCollectionSubcategoryItem | ResolvedCollectionProductItem>> {
  const sorted = sortItems(collection.items || []);
  const resolved: Array<ResolvedCollectionSubcategoryItem | ResolvedCollectionProductItem> = [];

  for (const item of sorted) {
    if (item.type === "subcategory" && item.subcategoryId) {
      const subcategory = await Subcategory.findById(item.subcategoryId);
      if (!subcategory || !subcategory.isActive) continue;

      const category = await Category.findById(subcategory.categoryId).select("_id name");
      if (!category) continue;

      let subcategoryProfileName = "";
      if (subcategory.subcategoryProfileId) {
        const profile = await SubcategoryProfile.findById(subcategory.subcategoryProfileId).select("name");
        subcategoryProfileName = profile?.name ?? "";
      }

      const customSubtext = String(subcategory.subtext || "").trim();
      resolved.push({
        itemId: String(item._id),
        type: "subcategory",
        subcategoryId: String(subcategory._id),
        categoryId: String(category._id),
        categoryName: category.name,
        subcategoryProfileId: subcategory.subcategoryProfileId
          ? String(subcategory.subcategoryProfileId)
          : undefined,
        subcategoryProfileName: subcategoryProfileName || undefined,
        name: subcategory.name,
        imageUrl: subcategory.thumbnailImage ?? "",
        subtext: customSubtext || `${Number(subcategory.productCount || 0)} Designs`,
        designCount: Number(subcategory.productCount || 0),
        infoText: subcategory.infoText ?? "",
        description: subcategory.description ?? "",
        filterSchema: subcategory.filterSchema ?? [],
      });
      continue;
    }

    if (item.type === "product" && item.productId) {
      const product = await Product.findById(item.productId);
      if (!product || !product.isActive) continue;

      const subcategory = await Subcategory.findById(product.subcategoryId);
      if (!subcategory || !subcategory.isActive) continue;

      const category = await Category.findById(product.categoryId).select("_id name");
      if (!category) continue;

      let subcategoryProfileName = "";
      if (product.subcategoryProfileId) {
        const profile = await SubcategoryProfile.findById(product.subcategoryProfileId).select("name");
        subcategoryProfileName = profile?.name ?? "";
      }

      const imageUrl =
        product.displayImage ||
        product.secondaryImage ||
        (Array.isArray(product.images) ? product.images[0] : "") ||
        "";

      resolved.push({
        itemId: String(item._id),
        type: "product",
        productId: String(product._id),
        styleNo: product.styleNo,
        name: String(product.name || product.styleNo || "Product"),
        imageUrl,
        categoryId: String(category._id),
        categoryName: category.name,
        subcategoryId: String(subcategory._id),
        subcategoryName: subcategory.name,
        subcategoryProfileId: product.subcategoryProfileId ? String(product.subcategoryProfileId) : undefined,
        subcategoryProfileName: subcategoryProfileName || undefined,
      });
    }
  }

  return resolved;
}

export async function getResolvedFeaturedCollection(
  collectionId: string,
): Promise<ResolvedFeaturedCollection | null> {
  if (!mongoose.Types.ObjectId.isValid(collectionId)) return null;

  const collection = await FeaturedCollection.findOne({ _id: collectionId, isActive: true });
  if (!collection) return null;

  const items = await resolveFeaturedCollectionItems(collection);

  return {
    _id: String(collection._id),
    name: collection.name,
    description: collection.description ?? "",
    bannerImageUrl: collection.bannerImageUrl,
    displayOrder: collection.displayOrder,
    items,
  };
}
