import { Router, Request, Response, NextFunction } from "express";
import {
  getBatchesByToken,
  getBatch,
  getReceiptsByWallet,
  getCompactorStats,
} from "../../db/compactor";

export const compactorRouter = Router();

// GET /compactor/batches?token=0x...
compactorRouter.get("/batches", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).json({ error: "token query parameter is required" });
      return;
    }
    const batches = await getBatchesByToken(token);
    res.json(batches);
  } catch (err) {
    next(err);
  }
});

// GET /compactor/batches/:token/:batchId
compactorRouter.get(
  "/batches/:token/:batchId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const batchId = Number(req.params.batchId);
      if (!Number.isFinite(batchId) || batchId < 0) {
        res.status(400).json({ error: "batchId must be a non-negative integer" });
        return;
      }
      const batch = await getBatch(req.params.token, batchId);
      if (!batch) {
        res.status(404).json({ error: "Batch not found" });
        return;
      }
      res.json(batch);
    } catch (err) {
      next(err);
    }
  },
);

// GET /compactor/receipts?wallet=0x...
compactorRouter.get("/receipts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wallet = req.query.wallet as string;
    if (!wallet) {
      res.status(400).json({ error: "wallet query parameter is required" });
      return;
    }
    const receipts = await getReceiptsByWallet(wallet);
    res.json(receipts);
  } catch (err) {
    next(err);
  }
});

// GET /compactor/stats
compactorRouter.get("/stats", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getCompactorStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});
