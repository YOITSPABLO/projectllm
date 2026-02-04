#!/usr/bin/env node
/*
  Agent Casino uninstall helper

  - Disables the skill entry (does not delete your file)
  - Does NOT automatically delete cron jobs (you may have multiple). Use `openclaw cron list` + `openclaw cron rm <jobId>`.
*/

import fs from "fs";
import os from "os";
import path from "path";

const skillKey = process.argv.includes("--skill-key") ? process.argv[process.argv.indexOf("--skill-key") + 1] : "agent-casino";
const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");

if (!fs.existsSync(cfgPath)) {
  console.log("No ~/.openclaw/openclaw.json found.");
  process.exit(0);
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
if (cfg?.skills?.entries?.[skillKey]) {
  cfg.skills.entries[skillKey].enabled = false;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`Disabled skill entry ${skillKey} in ${cfgPath}`);
} else {
  console.log(`No skill entry ${skillKey} in ${cfgPath}`);
}
