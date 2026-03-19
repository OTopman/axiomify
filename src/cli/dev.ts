import { spawn } from "child_process";
import path from "path";

/**
 * Executes the development environment with hot-reloading.
 */
export function runDevCommand() {
  console.log("🔄 Starting Axiomify in Watch Mode...");

  // We need to execute our internal bootstrap script, but we must do it
  // in a separate process so we can watch the user's TypeScript files.

  // To do this, we create a tiny temporary entrypoint string that evaluates our bootstrap function.
  const entryCode = `
    import { bootstrap } from 'axiomify/server/bootstrap';
    bootstrap();
  `;

  // We use `npx tsx watch` to seamlessly compile and reload the developer's code.
  // It watches the user's `src` directory by default.
  const child = spawn(
    "npx",
    ["tsx", "watch", "--clear-screen=false", "--eval", entryCode],
    {
      stdio: "inherit",
      shell: true,
      cwd: process.cwd(), // Run in the context of the user's project
    },
  );

  child.on("error", (err) => {
    console.error("❌ Failed to start dev server:", err);
  });
}
