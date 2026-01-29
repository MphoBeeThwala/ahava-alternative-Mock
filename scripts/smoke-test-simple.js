
async function runSmokeTest() {
    const timestamp = Date.now();
    const testEmail = `auto_test_img_${timestamp}@example.com`;
    const url = 'http://localhost:5173/api/auth/signup';

    console.log(`Target: ${url}`);
    console.log(`User: ${testEmail}`);

    try {
        // 1. Signup
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                password: 'TestPassword123!',
                name: 'Image Test User'
            })
        });

        console.log(`Signup Status: ${response.status}`);
        const text = await response.text();
        const data = JSON.parse(text);

        if (response.ok && data.success) {
            console.log("RESULT: SIGNUP SUCCESS");
            const userId = data.user.id; // Assuming we might need this later, but for now just validation

            // 2. Test Image Upload (Simulated) - requires cookie, so we skip for now unless we capture it.
            // For now, let's just confirm the signup works with the new DB schema.

        } else {
            console.log("RESULT: SIGNUP FAILURE");
            console.log("ERROR: " + JSON.stringify(data));
        }

    } catch (err) {
        console.log("RESULT: NETWORK FAILURE");
        console.log(err.message);
    }
}

runSmokeTest();
