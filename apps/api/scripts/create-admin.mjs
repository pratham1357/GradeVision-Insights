#!/usr/bin/env node
/**
 * Bootstrap an administrator account in a database that was NOT seeded (e.g.
 * production). Further accounts are then managed in the app's Admin page.
 *
 *   pnpm --filter @gradevision/api build
 *   ADMIN_PASSWORD='<12+ chars>' DATABASE_URL=... \
 *     node apps/api/scripts/create-admin.mjs --email admin@your.edu --name "Platform Admin"
 *
 * The password is read from ADMIN_PASSWORD (never a command-line argument, so it
 * does not land in shell history or process listings) and stored as an
 * Argon2id hash. Refuses if the email already exists. Prints no secrets.
 */
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const email = option("--email")?.trim().toLowerCase();
const name = option("--name")?.trim();
const password = process.env.ADMIN_PASSWORD ?? "";

function fail(message) {
  console.error(`create-admin: ${message}`);
  process.exit(2);
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("--email <address> is required");
if (!name) fail('--name "<full name>" is required');
if (password.length < 12) fail("ADMIN_PASSWORD must be set to at least 12 characters");
if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");

const { hashPassword } = await import("../dist/modules/auth/password.js");
const { prisma } = await import("../../../database/dist/index.js");

try {
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    fail(`an account with ${email} already exists`);
  }
  const user = await prisma.user.create({
    data: { email, name, role: "ADMIN", passwordHash: await hashPassword(password) },
    select: { id: true },
  });
  await prisma.auditEvent.create({
    data: {
      action: "user.created",
      entityType: "User",
      entityId: user.id,
      summary: `Bootstrap administrator ${email} created from the command line`,
      metadata: { role: "ADMIN", via: "create-admin" },
    },
  });
  console.log(`Administrator ${email} created.`);
} finally {
  await prisma.$disconnect();
}
