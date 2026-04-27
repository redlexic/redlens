#!/usr/bin/env node
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ATLAS = path.join(ROOT, "vendor/next-gen-atlas");
const LOG_DIR = path.join(ROOT, ".cache/walk-timeline");
const RESULTS = path.join(LOG_DIR, "results.txt");

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.writeFileSync(RESULTS, "");

const commits = execSync("git -C " + ATLAS + " log --format=%H", { encoding: "utf8" })
  .trim()
  .split("\n");
const TOTAL = commits.length;
console.log("Atlas: " + TOTAL + " commits total");
console.log("Walking up to 100 commits back, 5 at a time\n");

const MIN_PASS = 32;

function runAndTest(sha) {
  const short = sha.slice(0, 12);
  const log = path.join(LOG_DIR, short + ".log");
  const build = spawnSync("pnpm", ["build:at", sha], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  fs.writeFileSync(log, (build.stdout || "") + (build.stderr || ""));
  if (build.status !== 0) return { status: "BUILD_FAILED", passed: 0, failed: 99 };
  const test = spawnSync("pnpm", ["test"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  const out = (test.stdout || "") + (test.stderr || "");
  fs.appendFileSync(log, "\n--- TEST ---\n" + out);
  const passM = out.match(/\bTests\b.*?(\d+) passed/);
  const failM = out.match(/\bTests\b.*?(\d+) failed/);
  return {
    status: "OK",
    passed: passM ? parseInt(passM[1]) : 0,
    failed: failM ? parseInt(failM[1]) : 0,
  };
}

function getMsg(sha) {
  return execSync("git -C " + ATLAS + " log --format=%s -1 " + sha, { encoding: "utf8" }).trim();
}

let prev_i = 0,
  prev_fail = 0;

for (let i = 0; i <= 100 && i < TOTAL; i += 5) {
  const sha = commits[i];
  const short = sha.slice(0, 12);
  const msg = getMsg(sha);
  process.stdout.write("\n[" + String(i).padStart(3) + "] " + short + "  " + msg + "\n");
  const { status, passed, failed } = runAndTest(sha);
  process.stdout.write("      " + status + "  pass=" + passed + "   fail=" + failed + "\n");
  fs.appendFileSync(
    RESULTS,
    "MAIN " + i + " " + short + " " + status + " " + passed + " " + failed + " | " + msg + "\n",
  );

  if (failed > 0 && prev_fail === 0 && i > 0) {
    console.log("  *** BREAK between commits " + prev_i + "..." + i + " -- bisecting ***");
    let found = false;
    for (let j = prev_i + 1; j < i; j++) {
      const bsha = commits[j];
      const bshort = bsha.slice(0, 12);
      const bmsg = getMsg(bsha);
      process.stdout.write("  bisect[" + j + "] " + bshort + "  " + bmsg + "\n");
      const r = runAndTest(bsha);
      process.stdout.write(
        "           " + r.status + "  pass=" + r.passed + "   fail=" + r.failed + "\n",
      );
      fs.appendFileSync(
        RESULTS,
        "BISECT " +
          j +
          " " +
          bshort +
          " " +
          r.status +
          " " +
          r.passed +
          " " +
          r.failed +
          " | " +
          bmsg +
          "\n",
      );
      if (r.failed > 0 && !found) {
        console.log("  >>> BREAKS AT [" + j + "] " + bshort + ": " + bmsg + " <<<");
        fs.appendFileSync(
          RESULTS,
          "BREAK " + j + " " + bshort + " " + r.status + " " + r.passed + " | " + bmsg + "\n",
        );
        found = true;
      }
    }
  }

  if (passed < MIN_PASS) {
    console.log("STOP: only " + passed + " tests passing (< " + MIN_PASS + " threshold)");
    fs.appendFileSync(RESULTS, "STOP_LOW_PASS " + i + " " + short + " " + passed + "\n");
    break;
  }
  prev_i = i;
  prev_fail = failed;
}

console.log("\nRestoring submodule...");
execSync("pnpm build:at ede66d5f2cf3", { cwd: ROOT, stdio: "inherit" });
console.log("\n=== WALK COMPLETE ===\n");
console.log(fs.readFileSync(RESULTS, "utf8"));
