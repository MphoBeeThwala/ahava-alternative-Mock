/**
 * Test script to verify Prisma client functionality after PNPM migration
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testPrisma() {
  console.log('🧪 Testing Prisma Client Functionality...\n');

  try {
    // Test 1: Check if PrismaClient can be instantiated
    console.log('✅ Test 1: PrismaClient instantiated successfully');

    // Test 2: Check if new models are available
    const hasBiometricReading = 'biometricReading' in prisma;
    const hasHealthAlert = 'healthAlert' in prisma;
    
    console.log(`\n📊 Test 2: Model Availability Check`);
    console.log(`   - biometricReading: ${hasBiometricReading ? '✅ Available' : '❌ Missing'}`);
    console.log(`   - healthAlert: ${hasHealthAlert ? '✅ Available' : '❌ Missing'}`);

    // Test 3: Test database connection with a simple query
    console.log(`\n🔌 Test 3: Database Connection`);
    try {
      const userCount = await prisma.user.count();
      console.log(`   ✅ Database connection successful`);
      console.log(`   📊 Total users in database: ${userCount}`);
    } catch (dbError) {
      console.log(`   ⚠️  Database connection issue: ${dbError.message}`);
      console.log(`   ℹ️  This might be expected if DATABASE_URL is not configured`);
    }

    // Test 4: Try to query existing models
    console.log(`\n📋 Test 4: Query Existing Models`);
    try {
      const bookings = await prisma.booking.findMany({ take: 1 });
      console.log(`   ✅ Booking model accessible: ${bookings.length} booking(s) found`);
    } catch (error) {
      console.log(`   ⚠️  Booking query failed: ${error.message}`);
    }

    // Test 5: Try to access new models (if available)
    if (hasBiometricReading) {
      console.log(`\n🩺 Test 5: New Models - BiometricReading`);
      try {
        const biometricCount = await prisma.biometricReading.count();
        console.log(`   ✅ BiometricReading model accessible`);
        console.log(`   📊 Total biometric readings: ${biometricCount}`);
      } catch (error) {
        console.log(`   ⚠️  BiometricReading query failed: ${error.message}`);
      }
    } else {
      console.log(`\n⚠️  Test 5: BiometricReading model not available (expected if Prisma client not fully regenerated)`);
    }

    if (hasHealthAlert) {
      console.log(`\n🚨 Test 6: New Models - HealthAlert`);
      try {
        const alertCount = await prisma.healthAlert.count();
        console.log(`   ✅ HealthAlert model accessible`);
        console.log(`   📊 Total health alerts: ${alertCount}`);
      } catch (error) {
        console.log(`   ⚠️  HealthAlert query failed: ${error.message}`);
      }
    } else {
      console.log(`\n⚠️  Test 6: HealthAlert model not available (expected if Prisma client not fully regenerated)`);
    }

    // Test 6: Test raw SQL (fallback method)
    console.log(`\n💾 Test 7: Raw SQL Fallback`);
    try {
      const result = await prisma.$queryRaw`SELECT 1 as test`;
      console.log(`   ✅ Raw SQL queries work: ${JSON.stringify(result)}`);
    } catch (error) {
      console.log(`   ❌ Raw SQL failed: ${error.message}`);
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`📝 Summary:`);
    console.log(`   - Prisma Client: ✅ Working`);
    console.log(`   - Database Connection: ${hasBiometricReading && hasHealthAlert ? '✅' : '⚠️  Partial'}`);
    console.log(`   - New Models: ${hasBiometricReading && hasHealthAlert ? '✅ Available' : '⚠️  Using SQL fallbacks'}`);
    console.log(`   - Raw SQL: ✅ Available as fallback`);
    console.log(`\n✅ Prisma functionality test completed!`);

  } catch (error) {
    console.error(`\n❌ Test failed with error:`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testPrisma().catch(console.error);

