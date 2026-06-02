// Dev runner: starts the Bun API server (src/server/index.ts) and Vite
// together, prefixing each process's output with a colored [server] / [vite]
// label so the interleaved logs in `pnpm dev` are distinguishable. Replaces the
// old inline `bun … & vite & wait` script. FORCE_COLOR keeps each tool's own
// colors alive even though we pipe their stdio through here.
import { spawn } from "node:child_process";

const procs = [
  { name: "server", color: "\x1b[36m", cmd: "bun", args: ["src/server/index.ts"] }, // cyan
  { name: "vite", color: "\x1b[35m", cmd: "vite", args: [] }, // magenta
];

const reset = "\x1b[0m";
const width = Math.max(...procs.map((p) => p.name.length));

const children = procs.map(({ name, color, cmd, args }) => {
  const label = `${color}[${name.padEnd(width)}]${reset} `;
  const child = spawn(cmd, args, {
    env: { ...process.env, FORCE_COLOR: "1" },
    stdio: ["inherit", "pipe", "pipe"],
  });

  // Buffer until newline so a label is only ever prepended to a full line.
  const prefix = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) out.write(label + line + "\n");
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  return child;
});

let shuttingDown = false;
const killAll = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
};

process.on("SIGINT", killAll);
process.on("SIGTERM", killAll);

// If either process exits, tear the other down and propagate the exit code.
for (const c of children) {
  c.on("exit", (code) => {
    killAll();
    process.exit(code ?? 0);
  });
}
