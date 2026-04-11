import bcrypt from "bcryptjs";

import { env } from "../config/env";
import { AdminUser } from "../models/AdminUser";

export async function ensureAdminUser() {
  if (!env.ADMIN_EMAIL) throw new Error("ADMIN_EMAIL is not set");
  if (!env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is not set");

  const email = env.ADMIN_EMAIL.trim().toLowerCase();

  const existing = await AdminUser.findOne({ email });
  if (existing) return;

  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);

  await AdminUser.create({ email, passwordHash });
  console.log("Admin user bootstrapped:", email);
}

