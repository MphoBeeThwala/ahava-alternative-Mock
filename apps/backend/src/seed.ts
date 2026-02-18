/**
 * Seed script: create first admin user if none exist.
 * Set in .env: ADMIN_EMAIL, ADMIN_PASSWORD (required), optional ADMIN_FIRST_NAME, ADMIN_LAST_NAME.
 * Run: pnpm prisma:seed  or  npx prisma db seed
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('Seed skipped: set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.');
    return;
  }

  const existingAdmin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });

  if (existingAdmin) {
    console.log('An admin user already exists. Seed skipped.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: process.env.ADMIN_FIRST_NAME || 'Admin',
      lastName: process.env.ADMIN_LAST_NAME || 'User',
      role: 'ADMIN',
      preferredLanguage: 'en-ZA',
    },
  });

  console.log('First admin user created:', user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
