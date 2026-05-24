import dotenv from "dotenv";
import { type Server as HttpServer } from "http";
import mongoose from "mongoose";

import app from "./app";
import { connectDB } from "./config/db";
import { env } from "./config/env";
import {
  startSchedulers,
  stopSchedulers,
} from "./production-planner/services/bootstrap/schedulers";
import { seedDefaultColumnMaps } from "./production-planner/services/bootstrap/seedDefaultColumnMaps";
import { ensureAdminUser } from "./services/bootstrapAdmin";

dotenv.config();

const PORT = env.PORT;

async function start() {
  await connectDB();
  await ensureAdminUser();
  await seedDefaultColumnMaps();
  startSchedulers();

  const server: HttpServer = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Shutting down...`);
    stopSchedulers();
    server.close(() => {
      // Ensure mongoose is closed before exiting.
      mongoose.connection
        .close()
        .catch((err) => console.error("Error closing mongoose:", err))
        .finally(() => process.exit(0));
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

start().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Failed to start server:", message);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});

