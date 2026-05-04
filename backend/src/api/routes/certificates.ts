import { Router, Request, Response, NextFunction } from "express";
import { getBurnByTxHash } from "../../db/supabase";
import { generateCertificate } from "../../pdf/certificateGenerator";
import { getCertificate, putCertificate } from "../../storage/certificates";
import { getTokenMetadata } from "../../indexer/tokenMetadata";
import { getProvider } from "../../indexer/provider";

export const certificatesRouter = Router();

/// GET /certificates/:txHash — streams a Loss Certificate PDF.
/// Serves from Supabase Storage cache when present; regenerates on miss.
certificatesRouter.get("/:txHash", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txHash = req.params.txHash;

    let pdf = await getCertificate(txHash);

    if (!pdf) {
      const burn = await getBurnByTxHash(txHash);
      if (!burn) {
        res.status(404).json({ error: "Burn record not found" });
        return;
      }

      const meta = await getTokenMetadata(getProvider(), burn.token_address);
      pdf = await generateCertificate({
        ...burn,
        txHash: burn.tx_hash,
        token_symbol: meta.symbol,
        token_decimals: meta.decimals,
      });

      // Cache for next time. Don't fail the request if caching fails.
      putCertificate(txHash, pdf).catch((err) =>
        console.error("[Certificates] Cache write failed:", err),
      );
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="certificate-${txHash.slice(0, 10)}.pdf"`,
      "Content-Length": pdf.length.toString(),
      "Cache-Control": "public, max-age=31536000, immutable",
    });

    res.send(pdf);
  } catch (err) {
    next(err);
  }
});
