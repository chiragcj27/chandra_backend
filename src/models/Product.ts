import { Document, Schema, Types, model, models, type Model } from "mongoose";

export interface Diamond {
  shape?: string;
  sieveSize?: string;
  mmSize?: string;
  pcs?: number;
  avgPointer?: number;
  ctWeight?: number;
}

export interface MetalWeightValue {
  label?: string;
  value?: number;
}

export interface MetalWeights {
  gold10K?: MetalWeightValue;
  gold14K?: MetalWeightValue;
  gold18K?: MetalWeightValue;
  silver?: MetalWeightValue;
  platinum?: MetalWeightValue;
}

export interface ProductFilterValue {
  filterName: string;
  filterValue: string | string[];
}

export interface ProductDocument extends Document {
  styleNo: string;
  name?: string;
  categoryId: Types.ObjectId;
  subcategoryProfileId?: Types.ObjectId;
  subcategoryId: Types.ObjectId;
  makeType?: string;
  description?: string;
  remarks?: string;
  diamonds: Diamond[];
  totalDiamondPcs: number;
  totalDiamondWeightCt: number;
  pointer: number;
  metalWeights: MetalWeights;
  isReadyToShip: boolean;
  isBestSeller: boolean;
  filter: ProductFilterValue[];
  embedding?: number[];
  images: string[];
  displayImage?: string;
  secondaryImage?: string;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const DiamondSchema = new Schema<Diamond>(
  {
    shape: { type: String },
    sieveSize: { type: String },
    mmSize: { type: String },
    pcs: { type: Number },
    avgPointer: { type: Number },
    ctWeight: { type: Number },
  },
  { _id: false }
);

const MetalWeightValueSchema = new Schema<MetalWeightValue>(
  {
    label: { type: String },
    value: { type: Number },
  },
  { _id: false }
);

const MetalWeightsSchema = new Schema<MetalWeights>(
  {
    gold10K: { type: MetalWeightValueSchema },
    gold14K: { type: MetalWeightValueSchema },
    gold18K: { type: MetalWeightValueSchema },
    silver: { type: MetalWeightValueSchema },
    platinum: { type: MetalWeightValueSchema },
  },
  { _id: false }
);

const ProductFilterValueSchema = new Schema<ProductFilterValue>(
  {
    filterName: { type: String, required: true },
    filterValue: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

const ProductSchema = new Schema<ProductDocument>(
  {
    styleNo: { type: String, required: true, unique: true },
    name: { type: String },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    subcategoryProfileId: { type: Schema.Types.ObjectId, ref: "SubcategoryProfile" },
    subcategoryId: { type: Schema.Types.ObjectId, ref: "Subcategory", required: true },
    makeType: { type: String },
    description: { type: String },
    remarks: { type: String },
    diamonds: { type: [DiamondSchema], default: [] },
    totalDiamondPcs: { type: Number, default: 0 },
    totalDiamondWeightCt: { type: Number, default: 0 },
    pointer: { type: Number, default: 0 },
    metalWeights: { type: MetalWeightsSchema, default: {} },
    isReadyToShip: { type: Boolean, default: false },
    isBestSeller: { type: Boolean, default: false },
    filter: { type: [ProductFilterValueSchema], default: [] },
    embedding: { type: [Number], select: false },
    images: { type: [String], default: [] },
    displayImage: { type: String },
    secondaryImage: { type: String },
    isActive: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: true, strict: false }
);

ProductSchema.index({ styleNo: 1 }, { unique: true });
ProductSchema.index({ subcategoryId: 1, isActive: 1 });
ProductSchema.index({ subcategoryProfileId: 1, isActive: 1 });
ProductSchema.index({ isActive: 1, isBestSeller: 1, subcategoryId: 1 });
ProductSchema.index({ isActive: 1, isReadyToShip: 1, subcategoryId: 1 });

export const Product =
  models.Product
    ? (models.Product as Model<ProductDocument>)
    : model<ProductDocument>("Product", ProductSchema);

