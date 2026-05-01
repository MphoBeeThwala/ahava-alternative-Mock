import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();

async function manageAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || 'healthsysadmin@ahavaon88.co.za';
  const adminPassword = process.env.ADMIN_PASSWORD || 'WendziThingo@922';

  console.log('🔍 Checking for existing admin...');
  
  const existingAdmin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });

  if (!existingAdmin) {
    console.log('❌ No admin found in the database. Please run the prisma:seed command instead.');
    return;
  }

  console.log(`✅ Found existing admin: ${existingAdmin.email}`);
  
  const hash = await bcrypt.hash(adminPassword, 12);
  
  await prisma.user.update({
    where: { id: existingAdmin.id },
    data: {
      email: adminEmail,
      passwordHash: hash,
      isActive: true,
      isVerified: true
    }
  });

  console.log(`🚀 Admin account successfully updated!`);
  console.log(`   New Email: ${adminEmail}`);
  console.log(`   New Password: (the one you set in your command)`);
}

manageAdmin()
  .catch(err => {
    console.error('Error managing admin:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
