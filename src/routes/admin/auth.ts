import bcrypt from "bcryptjs";
import { Router } from "express";

import { AdminUser } from "../../models/AdminUser";
import { signAccessToken } from "../../services/jwt";

const router = Router();

router.post("/auth/login", async (req, res) => {
  try {
    const body = req.body as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const admin = await AdminUser.findOne({ email }).select("+passwordHash");
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signAccessToken({
      sub: admin._id.toString(),
      role: "admin",
    });

    return res.status(200).json({ token });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;

