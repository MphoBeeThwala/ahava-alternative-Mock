import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function targetedReset() {
  const keepEmail = 'themol581@gmail.com';
  
  console.log(`🚀 Starting targeted reset. Keeping user: ${keepEmail} and all ADMINS.`);

  try {
    // 1. Get the IDs of the users we want to keep
    const usersToKeep = await prisma.user.findMany({
      where: {
        OR: [
          { email: keepEmail },
          { role: 'ADMIN' }
        ]
      },
      select: { id: true, email: true, role: true }
    });

    const keepIds = usersToKeep.map(u => u.id);
    console.log(`👥 Keeping ${usersToKeep.length} users:`, usersToKeep.map(u => `${u.email} (${u.role})`));

    if (keepIds.length === 0) {
      console.error('❌ Could not find the specified user or any admin. Aborting to prevent total data loss.');
      return;
    }

    // 2. Delete transactional data for users we are NOT keeping
    // We do this first to respect foreign key constraints
    console.log('🧹 Cleaning up transactional data for other users...');
    
    // Get all bookings for users to be deleted to help with visit cleanup
    const bookingsToDelete = await prisma.booking.findMany({
      where: { patientId: { notIn: keepIds } },
      select: { id: true }
    });
    const bookingIdsToDelete = bookingsToDelete.map(b => b.id);

    await prisma.message.deleteMany({ where: { OR: [{ senderId: { notIn: keepIds } }, { recipientId: { notIn: keepIds } }] } });
    await prisma.biometricReading.deleteMany({ where: { userId: { notIn: keepIds } } });
    await prisma.userBaseline.deleteMany({ where: { userId: { notIn: keepIds } } });
    await prisma.visit.deleteMany({ where: { bookingId: { in: bookingIdsToDelete } } });
    await prisma.booking.deleteMany({ where: { patientId: { notIn: keepIds } } });
    await prisma.patientConsent.deleteMany({ where: { userId: { notIn: keepIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { notIn: keepIds } } });
    await prisma.healthAlert.deleteMany({ where: { userId: { notIn: keepIds } } });
    await prisma.triageCase.deleteMany({ where: { patientId: { notIn: keepIds } } });
    await prisma.prescription.deleteMany({ where: { patientId: { notIn: keepIds } } });
    await prisma.referral.deleteMany({ where: { patientId: { notIn: keepIds } } });

    // 3. Delete the users themselves
    console.log('🗑️ Deleting other users...');
    const deleteResult = await prisma.user.deleteMany({
      where: {
        id: { notIn: keepIds }
      }
    });

    console.log(`✅ Success! Deleted ${deleteResult.count} users and their associated data.`);
    console.log(`✨ The following users remain:`);
    usersToKeep.forEach(u => console.log(`   - ${u.email} [${u.role}]`));

  } catch (error) {
    console.error('❌ Reset failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

targetedReset();
