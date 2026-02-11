import { execSync } from "child_process";

export function reloadPingora(): boolean {
  try {
    // In Docker with s6-overlay
    execSync("s6-svc -h /run/s6-rc/servicedirs/pingora", {
      timeout: 5000,
    });
    return true;
  } catch {
    // Fallback: try sending SIGHUP via PID file
    try {
      const pid = execSync("cat /run/pingora.pid", { encoding: "utf-8" }).trim();
      execSync(`kill -HUP ${pid}`, { timeout: 5000 });
      return true;
    } catch {
      console.error("[reload] Failed to send SIGHUP to Pingora");
      return false;
    }
  }
}
