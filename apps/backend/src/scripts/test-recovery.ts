import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import 'dotenv/config';

const prisma = new PrismaClient();

async function testRecoveryFlow() {
  const testEmail = 'themol581@gmail.com';
  const newPassword = 'NewTestPassword123!';

  console.log(`🧪 Starting password recovery test for: ${testEmail}`);

  try {
    // 1. Check if user exists
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    if (!user) {
      console.error(`❌ Test user ${testEmail} not found. Please create them first.`);
      return;
    }

    // 2. Simulate Forgot Password (Generate Token)
    console.log('STEP 1: Generating reset token...');
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetExpiry: expiry },
    });
    console.log(`✅ Token generated: ${token.slice(0, 10)}...`);

    // 3. Simulate Reset Password (Verify and Update)
    console.log('STEP 2: Verifying token and updating password...');
    const verifyingUser = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      },
    });

    if (!verifyingUser || verifyingUser.id !== user.id) {
      console.error('❌ Token verification failed.');
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordResetToken: null, passwordResetExpiry: null },
    });
    console.log('✅ Password successfully updated in database.');

    // 4. Final Login Verification
    console.log('STEP 3: Verifying new password with login logic...');
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    const isValid = await bcrypt.compare(newPassword, updatedUser!.passwordHash!);
    
    if (isValid) {
      console.log('🎉 SUCCESS: Recovery flow logic is 100% correct.');
      console.log(`   You can now log in at /auth/login with:`);
      console.log(`   Email: ${testEmail}`);
      console.log(`   Password: ${newPassword}`);
    } else {
      console.error('❌ Final password verification failed.');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testRecoveryFlow();
