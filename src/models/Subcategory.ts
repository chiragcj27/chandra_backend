import { Document, Schema, Types, model, models, type Model } from "mongoose";

export type FilterFieldType = "chips" | "multi_chips" | "dropdown";
export type WeightDisplayType = "pointer" | "carat" | "both";

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterField {
  key: string;
  label: string;
  type: FilterFieldType;
  displayOrder: number;
  options: FilterOption[];
}

export interface SubcategoryDocument extends Document {
  categoryId: Types.ObjectId;
  subcategoryProfileId?: Types.ObjectId;
  name: string;
  subtext?: string;
  description?: string;
  thumbnailImage?: string;
  images: string[];
  displayOrder: number;
  isActive: boolean;
  isBestSeller: boolean;
  isReadyToShip: boolean;
  productCount: number;
  infoText?: string;
  specialNotePlaceholderText?: string;
  weightDisplay: WeightDisplayType;
  filterSchema: FilterField[];
  createdAt: Date;
  updatedAt: Date;
}

const FilterOptionSchema = new Schema<FilterOption>(
  {
    label: { type: String, required: true },
    value: { type: String, required: true },
  },
  { _id: false }
);

const FilterFieldSchema = new Schema<FilterField>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ["chips", "multi_chips", "dropdown"], default: "chips" },
    displayOrder: { type: Number, default: 0 },
    options: { type: [FilterOptionSchema], default: [] },
  },
  { _id: false }
);

const SubcategorySchema = new Schema<SubcategoryDocument>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    subcategoryProfileId: { type: Schema.Types.ObjectId, ref: "SubcategoryProfile" },
    name: { type: String, required: true },
    subtext: { type: String },
    description: { type: String },
    thumbnailImage: { type: String },
    images: { type: [String], default: [] },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isBestSeller: { type: Boolean, default: false },
    isReadyToShip: { type: Boolean, default: false },
    productCount: { type: Number, default: 0 },
    infoText: { type: String },
    specialNotePlaceholderText: { type: String },
    weightDisplay: { type: String, enum: ["pointer", "carat", "both"], default: "pointer" },
    filterSchema: { type: [FilterFieldSchema], default: [] },
  },
  { timestamps: true }
);

SubcategorySchema.index({ categoryId: 1, subcategoryProfileId: 1 });

export const Subcategory =
  models.Subcategory
    ? (models.Subcategory as Model<SubcategoryDocument>)
    : model<SubcategoryDocument>("Subcategory", SubcategorySchema);

