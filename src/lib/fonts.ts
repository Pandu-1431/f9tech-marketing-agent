import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export * from "./font-choices";

let configured = false;

/** Points fontconfig at assets/fonts (plus the system fonts). Safe to call many times; must run before the first render. */
export function ensureFonts(): void {
  if (configured) return;
  configured = true;
  const dir = path.join(process.cwd(), "assets", "fonts");
  if (!fs.existsSync(dir)) return; // fonts missing: system fonts are used
  const confDir = path.join(os.tmpdir(), "marketing-agent-fonts");
  fs.mkdirSync(path.join(confDir, "cache"), { recursive: true });
  const conf = path.join(confDir, "fonts.conf");
  const xml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${dir}</dir>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <include ignore_missing="yes">/opt/homebrew/etc/fonts/fonts.conf</include>
  <include ignore_missing="yes">/usr/local/etc/fonts/fonts.conf</include>
  <dir>/System/Library/Fonts</dir>
  <dir>/Library/Fonts</dir>
  <cachedir>${path.join(confDir, "cache")}</cachedir>
</fontconfig>`;
  fs.writeFileSync(conf, xml);
  // Respect an explicit setting (e.g. a server with its own fontconfig).
  if (!process.env.FONTCONFIG_FILE) process.env.FONTCONFIG_FILE = conf;
}
