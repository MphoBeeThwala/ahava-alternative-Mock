/**
 * The ML service's least-privilege database login (scripts/ml-db-role.ts),
 * provisioned and then probed as that role against a real database.
 */
import { dropMlRole, provisionMlRole, verifyMlRole } from "./ml-db-role";

const ROLE = `ahava_ml_test_${Math.random().toString(36).slice(2, 8)}`;

function asRole(url: string, user: string, password: string) {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

afterAll(async () => {
  await dropMlRole(process.env.DATABASE_URL!, ROLE);
});

describe("ML service database role", () => {
  it("can read/write its own vitals table and risk profile, and nothing else", async () => {
    const owner = process.env.DATABASE_URL!;
    await provisionMlRole(owner, ROLE, "first-password-123");

    const result = await verifyMlRole(asRole(owner, ROLE, "first-password-123"));

    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.checks.length).toBeGreaterThanOrEqual(10);
  });

  it("re-runs cleanly and rotates the password", async () => {
    const owner = process.env.DATABASE_URL!;
    await provisionMlRole(owner, ROLE, "second-password-456");

    const result = await verifyMlRole(asRole(owner, ROLE, "second-password-456"));
    expect(result.ok).toBe(true);
    await expect(verifyMlRole(asRole(owner, ROLE, "first-password-123"))).rejects.toThrow();
  });

  it("refuses an unsafe role name", async () => {
    await expect(provisionMlRole(process.env.DATABASE_URL!, 'x"; DROP TABLE users; --', "pw")).rejects.toThrow(/Invalid role name/);
  });
});
