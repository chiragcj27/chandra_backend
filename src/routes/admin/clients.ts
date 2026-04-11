import bcrypt from "bcryptjs";
import { Router } from "express";

import { env } from "../../config/env";
import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { ClientUser } from "../../models/ClientUser";
import { slugify } from "../../utils/slugify";
import { deterministicPasswordFromClientName } from "../../utils/deterministicPassword";

const router = Router();

router.post(
  "/clients",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const body = req.body as { clientName?: string };
      const clientNameRaw = body.clientName;
      const clientName = clientNameRaw?.trim();

      if (!clientName || clientName.length < 2) {
        return res.status(400).json({ error: "clientName is required" });
      }

      const username = slugify(clientName);
      const plaintextPassword =
        deterministicPasswordFromClientName(clientName, env.PASSWORD_SEED, 16);

      const existing = await ClientUser.findOne({ username });
      if (existing) {
        return res.status(200).json({
          clientName: existing.clientName,
          username: existing.username,
          password: plaintextPassword,
        });
      }

      const passwordHash = await bcrypt.hash(plaintextPassword, 12);

      await ClientUser.create({
        clientName,
        username,
        passwordHash,
      });

      return res.status(201).json({
        clientName,
        username,
        password: plaintextPassword,
      });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;

