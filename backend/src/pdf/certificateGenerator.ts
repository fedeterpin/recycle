import PDFDocument from "pdfkit";
import { ethers } from "ethers";

const RCY_DECIMALS = 18;

export interface CertificateInput {
  txHash: string;
  user_address: string;
  token_address: string;
  amount: string;          // raw integer (token's smallest unit)
  rcy_rewarded: string;    // raw integer (1e18)
  usd_value: string;       // raw integer (1e18)
  certificate_id: string;
  burned_at: string;
  token_symbol: string;
  token_decimals: number;
}

/// @notice Generates a Loss Certificate PDF for a completed burn event.
///         Amounts are rendered in human-readable units using the token's
///         decimals and symbol — never raw wei.
/// @returns Raw PDF as a Buffer.
export function generateCertificate(data: CertificateInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc
      .fontSize(24)
      .fillColor("#1a1a2e")
      .text("RECYCLE PROTOCOL", { align: "center" });

    doc
      .fontSize(16)
      .fillColor("#16213e")
      .text("LOSS CERTIFICATE / CONSTANCIA DE PÉRDIDA", { align: "center" });

    doc.moveDown(2);

    doc
      .fontSize(12)
      .fillColor("#333")
      .text(
        `This document certifies that the following token burn was executed on-chain and is permanently recorded on the blockchain.`,
        { align: "justify" },
      );

    doc.moveDown(1.5);

    const amountFormatted = `${ethers.formatUnits(data.amount, data.token_decimals)} ${data.token_symbol}`;
    const rcyFormatted = `${ethers.formatUnits(data.rcy_rewarded, RCY_DECIMALS)} RCY`;
    const usdFormatted = data.usd_value === "0"
      ? "Not available (token had no market price)"
      : `$${ethers.formatUnits(data.usd_value, 18)}`;

    const fields: [string, string][] = [
      ["Certificate ID",   `#${data.certificate_id}`],
      ["Transaction Hash", data.txHash],
      ["Wallet Address",   data.user_address],
      ["Token Address",    data.token_address],
      ["Amount Burned",    amountFormatted],
      ["USD Value at Burn", usdFormatted],
      ["RCY Rewarded",     rcyFormatted],
      ["Date & Time",      data.burned_at],
    ];

    for (const [label, value] of fields) {
      doc.fontSize(10).fillColor("#666").text(label.toUpperCase(), { continued: false });
      doc.fontSize(11).fillColor("#111").text(value).moveDown(0.5);
    }

    doc.moveDown(2);

    doc
      .fontSize(9)
      .fillColor("#aaa")
      .text(
        "This certificate was generated automatically by the Recycle Protocol indexer. " +
        "The on-chain transaction hash is the authoritative proof of burn.",
        { align: "center" },
      );

    doc.end();
  });
}
