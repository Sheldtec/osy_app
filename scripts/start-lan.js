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
const os = require("os");
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

const host = lanAddress();

if (!host) {
  console.error(
    "\nNo LAN address found — this machine looks offline, or only has virtual adapters.\n" +
      "Connect to the same Wi-Fi as your phone and try again.\n",
  );
  process.exit(1);
}

console.log(`\nServing Expo on ${host} — your phone must be on this same network.\n`);

spawn("npx", ["expo", "start", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: host },
}).on("exit", (code) => process.exit(code ?? 0));
