import { expect, test, type Page } from "@playwright/test";

/**
 * The core clinical path, end to end in a real browser:
 *
 *   patient signs up → logs in → describes a red-flag symptom → gives
 *   informed consent → case is created and shown as under doctor review →
 *   a doctor logs in and sees that case in their queue, escalated.
 *
 * Runs with no AI provider, Redis or ML service configured (see run.mjs), so
 * the triage level comes from the deterministic safety net alone — "chest
 * pain" must reach the doctor at SATS level 2 or more urgent regardless of
 * whether any AI is available.
 */

const API = process.env.E2E_API_URL || "http://127.0.0.1:4100";
const PASSWORD = "E2e-Test-Password-123!";

function uniqueEmail(role: string, projectName: string) {
  return `e2e-${role}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
}

async function login(page: Page, email: string) {
  await page.goto("/auth/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
}

test.describe.serial("patient symptom check reaches a doctor", () => {
  let patientEmail: string;
  let doctorEmail: string;
  let symptomText: string;

  // Staff accounts need the registration secret, which the signup page asks
  // for in a separate field; created through the API to keep this test about
  // the patient-to-doctor path.
  test.beforeAll(async ({ request }, info) => {
    doctorEmail = uniqueEmail("doctor", info.project.name);
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        firstName: "Neo",
        lastName: "E2E",
        email: doctorEmail,
        password: PASSWORD,
        role: "DOCTOR",
        adminSecret: process.env.E2E_STAFF_SECRET,
      },
    });
    expect(reg.status(), await reg.text()).toBeLessThan(300);
  });

  test("patient signs up through the UI and lands on their dashboard", async ({ page }, info) => {
    patientEmail = uniqueEmail("patient", info.project.name);
    await page.goto("/auth/signup");
    await page.getByLabel("First name").fill("Thandi");
    await page.getByLabel("Last name").fill("E2E");
    await page.getByLabel(/email/i).fill(patientEmail);
    await page.getByLabel(/^password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /create .*account|sign up/i }).click();
    await expect(page).toHaveURL(/\/patient\/dashboard/);
  });

  test("patient logs in, submits chest pain, consents, and the case goes to review", async ({ page }) => {
    await login(page, patientEmail);
    await expect(page).toHaveURL(/\/patient\/dashboard/);

    await page.goto("/patient/ai-doctor");
    symptomText = `Crushing chest pain since this morning, spreading to my left arm (${Date.now()})`;
    await page.locator("#triage-symptoms").fill(symptomText);
    await page.getByRole("button", { name: "Submit for doctor review" }).click();

    // First use: the API refuses with CONSENT_REQUIRED and the UI must ask.
    await expect(page.getByRole("heading", { name: "Informed Consent Required" })).toBeVisible();
    await expect(page.getByRole("button", { name: /I consent/ })).toBeDisabled();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /I consent/ }).click();

    await expect(page.getByRole("heading", { name: "Under doctor review" })).toBeVisible();
    // The emergency numbers must be on screen while the patient waits.
    await expect(page.getByText("10177")).toBeVisible();
  });

  test("a doctor logs in and sees the case, escalated", async ({ page }) => {
    await login(page, doctorEmail);
    await expect(page).toHaveURL(/\/doctor\/dashboard/);

    // New cases land unassigned in the shared review queue (the same call the
    // dashboard makes). The deterministic floor for "chest pain" is SATS
    // level 2 (Emergency). Checked through the doctor's own authenticated API
    // view as well as the page, so a UI that drops the level can't pass.
    const cases = await page.evaluate(async () => {
      const res = await fetch("/api/triage-review?status=all", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    expect(cases.status).toBe(200);
    const list: Array<{ symptoms?: string; aiTriageLevel?: number }> = cases.body.cases;
    const mine = list.find((c) => c.symptoms === symptomText);
    expect(mine, "patient's case not in the doctor's queue").toBeTruthy();
    expect(mine!.aiTriageLevel).toBeLessThanOrEqual(2);

    await expect(page.getByText(symptomText)).toBeVisible();
  });
});
