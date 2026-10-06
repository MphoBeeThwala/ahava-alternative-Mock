/**
 * The research tooling's read-only database login (scripts/research-db-role.ts),
 * provisioned and then probed as that role against a real database.
 */
import { dropResearchRole, provisionResearchRole, verifyResearchRole } from "./research-db-role";

const ROLE = `ahava_research_test_${Math.random().toString(36).slice(2, 8)}`;

function asRole(url: string, user: string, password: string) {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

afterAll(async () => {
  await dropResearchRole(process.env.DATABASE_URL!, ROLE);
});

describe("research database role", () => {
  it("reads the research tables, writes nothing, and sees no identified data", async () => {
    const owner = process.env.DATABASE_URL!;
    await provisionResearchRole(owner, ROLE, "first-password-123");
    const result = await verifyResearchRole(asRole(owner, ROLE, "first-password-123"));
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.checks.length).toBeGreaterThanOrEqual(14);
  });

  it("re-runs cleanly and rotates the password", async () => {
    const owner = process.env.DATABASE_URL!;
    await provisionResearchRole(owner, ROLE, "second-password-456");
    expect((await verifyResearchRole(asRole(owner, ROLE, "second-password-456"))).ok).toBe(true);
    await expect(verifyResearchRole(asRole(owner, ROLE, "first-password-123"))).rejects.toThrow();
  });

  it("refuses an unsafe role name", async () => {
    await expect(provisionResearchRole(process.env.DATABASE_URL!, 'x"; DROP TABLE users; --', "pw")).rejects.toThrow(/Invalid role name/);
  });
});
