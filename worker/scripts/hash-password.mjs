import { pbkdf2Sync, randomBytes } from "node:crypto";

function readPassword() {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { value += chunk; });
      process.stdin.on("end", () => resolve(value.trimEnd()));
      process.stdin.on("error", reject);
      return;
    }

    process.stdout.write("Admin password: ");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let value = "";
    const onData = (key) => {
      if (key === "\u0003") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        reject(new Error("Cancelled"));
      } else if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (key === "\u007f" || key === "\b") {
        value = value.slice(0, -1);
      } else if (key >= " ") {
        value += key;
      }
    };
    process.stdin.on("data", onData);
  });
}

try {
  const password = await readPassword();
  if (password.length < 12) throw new Error("Use a password with at least 12 characters.");
  const iterations = 310000;
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  process.stdout.write(`pbkdf2-sha256$${iterations}$${salt.toString("base64")}$${hash.toString("base64")}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Could not create password hash."}\n`);
  process.exitCode = 1;
}

