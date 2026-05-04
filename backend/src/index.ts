import { createServer } from "./api/server";
import { startIncineratorListener } from "./indexer/incineratorListener";
import { config } from "./config";

async function main() {
  // Start HTTP API
  const app = createServer();
  const server = app.listen(config.port, () => {
    console.log(`[API] Server listening on port ${config.port}`);
  });

  // Start blockchain event indexer
  await startIncineratorListener();

  // Graceful shutdown
  const shutdown = () => {
    console.log("[Main] Shutting down...");
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[Main] Fatal error:", err);
  process.exit(1);
});
