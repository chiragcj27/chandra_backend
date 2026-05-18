import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db";
import { listObjectsByPrefix } from "../src/services/s3";
import { MediaAsset } from "../src/models/MediaAsset";

dotenv.config();

async function run() {
  await connectDB();
  let continuationToken: string | undefined = undefined;
  let count = 0;

  console.log("Syncing media from S3...");

  do {
    const res = await listObjectsByPrefix({
      prefix: "media/admin-library/",
      maxKeys: 100,
      continuationToken,
    });

    for (const item of res.items) {
      const existing = await MediaAsset.findOne({ key: item.key });
      if (!existing) {
        // extract a name from the key: media/admin-library/<uuid>-<filename>
        const parts = item.key.replace("media/admin-library/", "").split("-");
        if (parts.length > 1) {
          parts.shift(); // remove uuid
        }
        const name = parts.join("-") || item.key.replace("media/admin-library/", "");
        
        await MediaAsset.create({
          name,
          key: item.key,
          publicUrl: item.publicUrl,
          size: item.size,
          createdAt: new Date(item.lastModified),
        });
        console.log(`Synced ${name}`);
        count++;
      }
    }

    continuationToken = res.nextContinuationToken;
  } while (continuationToken);

  console.log(`Synced ${count} items. Done.`);
  await mongoose.disconnect();
}

run().catch(console.error);
