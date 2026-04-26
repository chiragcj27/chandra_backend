import { Router } from "express";

import { requireAuth } from "../middleware/requireAuth";
import { ClientUser } from "../models/ClientUser";
import { LegacyClient } from "../models/LegacyClient";

const router = Router();

router.get("/clients/me/name", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const modernClient = await ClientUser.findById(userId).select("clientName username");
    if (modernClient) {
      return res.status(200).json({
        clientId: String(userId),
        clientName: modernClient.clientName,
        source: "client_users",
      });
    }

    const legacyClient = await LegacyClient.findById(userId).select("Name");
    if (!legacyClient?.Name?.trim()) {
      return res.status(404).json({ error: "Client not found" });
    }

    return res.status(200).json({
      clientId: String(userId),
      clientName: legacyClient.Name.trim(),
      source: "legacy_clients",
    });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/clients/:id/name", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Client id is required" });

    if (req.user?.role === "client" && req.user.id !== id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const modernClient = await ClientUser.findById(id).select("clientName username");
    if (modernClient) {
      return res.status(200).json({
        clientId: id,
        clientName: modernClient.clientName,
        source: "client_users",
      });
    }

    const legacyClient = await LegacyClient.findById(id).select("Name");
    if (!legacyClient?.Name?.trim()) {
      return res.status(404).json({ error: "Client not found" });
    }

    return res.status(200).json({
      clientId: id,
      clientName: legacyClient.Name.trim(),
      source: "legacy_clients",
    });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
