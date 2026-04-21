
async function testAI() {
    const url = 'http://localhost:5173/api/diagnostic-analysis';
    // Use a mock token - in dev environment, auth middleware might check for session/user
    // For this test to pass, we might need a valid session cookie or similar.
    // However, first let's see if we even reach the endpoint.

    console.log("Testing AI Endpoint:", url);

    // Note: This test simulates the payload structure.
    // Since we can't easily fake a session cookie in node fetch without login first, 
    // we are primarily testing if the endpoint exists and accepts the payload structure, 
    // even if it returns 401 (Unauthorized) that proves the route works. 
    // Ideally, we want to see it fail with 401, or succeed if we can bypass auth.

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // Mock session cookie or header if feasible, but hard without login
            },
            body: JSON.stringify({
                symptoms: "Severe headache and sensitivity to light.",
                // No images for now
            })
        });

        console.log(`Status: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.log("Response:", text);

    } catch (e) {
        console.error("Network Error:", e);
    }
}

testAI();
