#!/usr/bin/env node
/**
 * Start Expo on an address a phone can actually reach.
 *
 * `expo start` on this machine advertises `hostUri: 127.0.0.1:8081`, and on a
 * phone 127.0.0.1 is the PHONE — so Expo Go asks itself for the bundle and the
 * app never opens. It falls back to localhost because it cannot confidently
 * pick a LAN interface when virtual adapters (VMware, VirtualBox, WSL, Docker)
 * sit alongside the real one.
 *
 * `expo start --lan` is the usual answer, but it makes that same ambiguous
 * choice and can land on a 192.168.x.1 virtual adapter the phone cannot route
 * to. So this picks the interface deliberately and pins it.
 *
 * It DERIVES the address every run rather than reading one from .env, because
 * the Wi-Fi lease here has already moved twice (192.168.179.175 →
 * 192.168.1.227). A pinned address goes stale silently and looks exactly like
 * "Expo is broken".
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

/** Adapters that exist on this machine but are not the way out to the LAN. */
const VIRTUAL = /vmware|virtualbox|vethernet|hyper-v|wsl|docker|loopback|bluetooth|tap|tun/i;

function lanAddress() {
  const candidates = [];

  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;

    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      // 169.254.x.x is what Windows assigns when DHCP failed — routable to
      // nothing.
      if (a.address.startsWith("169.254.")) continue;

      candidates.push({ name, address: a.address });
    }
  }

  if (candidates.length === 0) return null;

  // Wi-Fi first: a phone is on Wi-Fi, so when a machine is on both that is the
  // side they share.
  const wifi = candidates.find((c) => /wi-?fi|wlan|wireless/i.test(c.name));

  return (wifi ?? candidates[0]).address;
}

/**
 * The API URL, with its HOST replaced by the address just derived.
 *
 * The exact staleness this script exists to prevent was happening one layer
 * over: EXPO_PUBLIC_API_URL in .env pinned 192.168.76.175, the Wi-Fi lease
 * moved to 192.168.207.175, and the app bundled perfectly and then fetched
 * nothing -- "the app is not fetching the products", with a healthy API
 * answering on localhost the whole time. Metro's host was derived and right;
 * the API's was typed and wrong, and nothing made the two agree.
 *
 * Only the HOST comes from the interface. The port and path stay whatever .env
 * says, because those are real configuration: the API does not always sit on
 * 8001 and the prefix is not always /api.
 *
 * Returned rather than written. .env is the owner's file and a script that
 * rewrote it every run would fight them for it; Expo's loader does not override
 * a variable already present in the environment, so handing it to the child is
 * enough.
 */
function apiUrlFor(host) {
  const envPath = path.join(__dirname, "..", ".env");

  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch {
    return null; // No .env - nothing to correct, and mock data is the fallback.
  }

  const line = raw
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith("EXPO_PUBLIC_API_URL="));
  if (!line) return null;

  const value = line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null; // Not a URL we can reason about; leave it alone.
  }

  // A deliberately non-LAN target -- a staging box, a tunnel -- is left alone.
  // Only an address of the private shape this machine itself hands out can
  // plausibly have gone stale.
  const privateHost = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$)/i;
  if (!privateHost.test(url.hostname)) return null;
  if (url.hostname === host) return null; // Already right.

  const before = url.href;
  url.hostname = host;

  return { url: url.href, before };
}

const host = lanAddress();

if (!host) {
  console.error(
    "\nNo LAN address found — this machine looks offline, or only has virtual adapters.\n" +
      "Connect to the same Wi-Fi as your phone and try again.\n",
  );
  process.exit(1);
}

console.log(`\nServing Expo on ${host} — your phone must be on this same network.\n`);

const api = apiUrlFor(host);
if (api) {
  console.log(`API host follows it: ${api.before} -> ${api.url}`);
  console.log("(.env is untouched - this run only.)");
}

spawn("npx", ["expo", "start", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    REACT_NATIVE_PACKAGER_HOSTNAME: host,
    ...(api ? { EXPO_PUBLIC_API_URL: api.url } : {}),
  },
}).on("exit", (code) => process.exit(code ?? 0));
