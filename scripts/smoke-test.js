
async function runSmokeTest() {
    console.log("🚀 Starting Smoke Test...");
    const timestamp = Date.now();
    const testEmail = `auto_test_${timestamp}@example.com`;
    const url = 'http://localhost:5173/api/auth/signup';

    console.log(`📡 Target: ${url}`);
    console.log(`👤 Creating user: ${testEmail}`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                password: 'TestPassword123!'
            })
        });

        console.log(`\nResponse Status: ${response.status} ${response.statusText}`);

        const text = await response.text();
        try {
            const data = JSON.parse(text);
            console.log('Response Body:', JSON.stringify(data, null, 2));

            if (response.ok && data.success) {
                console.log("\n✅ PASSED: Signup successful!");
                console.log(`   User ID: ${data.user.id}`);
            } else {
                console.log("\n❌ FAILED: Signup returned error.");
            }
        } catch (e) {
            console.log('Raw Response:', text);
            console.log("\n❌ FAILED: Could not parse JSON response.");
        }

    } catch (err) {
        console.error('\n❌ FAILED: Network error or server not reachable.');
        console.error(err);
    }
}

runSmokeTest();
