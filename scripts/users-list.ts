/**
 * List users in the local user directory. Never prints hashes or salts.
 * Usage: npm run users:list
 */
import { listUsers, usersFilePath } from "@/lib/security/users";
import { resolveAuthMode } from "@/lib/security/auth-mode";

function main() {
  const users = listUsers();
  console.log(`Users in ${usersFilePath()} (${users.length}) · auth mode: ${resolveAuthMode()}`);
  if (users.length === 0) {
    console.log('  none — add one with: npm run users:add -- --email you@example.com --name "Name" --role OWNER');
    return;
  }
  const w = Math.max(...users.map((u) => u.email.length), 5);
  for (const u of users) console.log(`  ${u.email.padEnd(w)}  ${u.role.padEnd(16)}  ${u.displayName}  (${u.id}, created ${u.createdAt.slice(0, 10)})`);
}

main();
