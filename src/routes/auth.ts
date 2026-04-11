import bcrypt from "bcryptjs";
import { Router } from "express";

import { requireAuth, requireRole } from "../middleware/requireAuth";
import { ClientUser } from "../models/ClientUser";
import { signAccessToken } from "../services/jwt";

const router = Router();

router.post("/login", async (req, res) => {
  try {
    const body = req.body as { username?: string; password?: string };
    const username = body.username?.trim().toLowerCase();
    const password = body.password;

    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    const client = await ClientUser.findOne({ username }).select("+passwordHash");
    if (!client) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, client.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signAccessToken({
      sub: client._id.toString(),
      role: "client",
      username: client.username,
    });

    return res.status(200).json({ token });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/me", requireAuth, requireRole("client"), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await ClientUser.findById(userId).select("username clientName");
    if (!client) return res.status(404).json({ error: "Client not found" });

    return res.status(200).json({ username: client.username, clientName: client.clientName });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;

