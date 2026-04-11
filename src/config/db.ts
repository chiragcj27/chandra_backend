import mongoose from "mongoose";

import { env } from "./env";

export async function connectDB() {
  // Helps avoid strict path filter issues when updating queries.
  mongoose.set("strictQuery", true);

  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB");
}

