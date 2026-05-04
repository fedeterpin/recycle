import { Router, Request, Response, NextFunction } from "express";
import { getBurnsByWallet, getBurnByTxHash } from "../../db/supabase";

export const burnsRouter = Router();

// GET /burns?wallet=0x...
burnsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wallet = req.query.wallet as string;
    if (!wallet) {
      res.status(400).json({ error: "wallet query parameter is required" });
      return;
    }
    const burns = await getBurnsByWallet(wallet);
    res.json(burns);
  } catch (err) {
    next(err);
  }
});

// GET /burns/:txHash
burnsRouter.get("/:txHash", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const burn = await getBurnByTxHash(req.params.txHash);
    if (!burn) {
      res.status(404).json({ error: "Burn not found" });
      return;
    }
    res.json(burn);
  } catch (err) {
    next(err);
  }
});
