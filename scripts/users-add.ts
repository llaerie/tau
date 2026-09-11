/**
 * Add a user to the local user directory (.tau/users.json, or TAU_USERS_FILE).
 *
 * Usage:
 *   npm run users:add -- --email you@example.com --name "Name" --role OWNER
 *   TAU_NEW_PASSWORD='…' npm run users:add -- --email … --name … --role … --password-env TAU_NEW_PASSWORD
 *
 * Without --password-env the password is prompted on stdin with echo muted.
 * Roles: OWNER, FINANCE_OPERATOR, CPA, VIEWER. Passwords must be at least 12 characters.
 * The password is never printed, logged or stored in plain text.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { createUser, hasUsers, MIN_PASSWORD_LENGTH, USER_ROLES, usersFilePath } from "@/lib/security/users";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Prompt with output muted after the label so the typed password is not echoed. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolvePrompt, rejectPrompt) => {
    let muted = false;
    const muteable = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output: muteable, terminal: true });
    rl.question(label, (answer) => {
      muted = false;
      process.stdout.write("\n");
      rl.close();
      resolvePrompt(answer);
    });
    muted = true;
    rl.on("SIGINT", () => {
      rl.close();
      process.stdout.write("\n");
      rejectPrompt(new Error("Cancelled"));
    });
  });
}

async function readPassword(): Promise<string> {
  const envName = arg("password-env");
  if (envName) {
    const v = process.env[envName];
    if (!v) throw new Error(`Environment variable ${envName} is empty or unset`);
    return v;
  }
  if (!process.stdin.isTTY) throw new Error("stdin is not a TTY; pass --password-env VAR_NAME instead");
  const first = await promptHidden("Password (input hidden): ");
  const second = await promptHidden("Confirm password: ");
  if (first !== second) throw new Error("Passwords do not match");
  return first;
}

async function main() {
  const email = arg("email");
  const name = arg("name");
  const role = (arg("role") ?? "").toUpperCase();
  if (!email || !name || !role) {
    console.error(`Usage: npm run users:add -- --email you@example.com --name "Name" --role ${USER_ROLES.join("|")} [--password-env VAR]`);
    process.exit(2);
  }
  const firstUser = !hasUsers();
  const password = await readPassword();
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const user = createUser({ email, displayName: name, role, password });
  console.log(`Created ${user.role} ${user.displayName} <${user.email}> (id ${user.id})`);
  console.log(`  directory: ${usersFilePath()}`);
  if (firstUser) {
    console.log("  Auth mode is now FULL by default (TAU_AUTH_MODE unset): every page requires sign-in at /login.");
    if (!process.env.TAU_SESSION_SECRET) console.log("  TAU_SESSION_SECRET is not set; a random secret will be generated at .tau/session-secret on first use.");
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
