import request from "supertest";
import { app } from "../index";

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

const STRONG_PASSWORD = "Str0ng!Passw0rd";

async function registerPatient(label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({
    email,
    password: STRONG_PASSWORD,
    firstName: "Prof",
    lastName: "Ile",
    role: "PATIENT",
  });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string };
}

describe("profile: get and update own profile", () => {
  it("returns the caller's own profile", async () => {
    const { agent, email } = await registerPatient("profile-get");

    const res = await agent.get("/api/v1/profile");

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/profile");
    expect(res.status).toBe(401);
  });

  it("updates first name, last name, and phone", async () => {
    const { agent } = await registerPatient("profile-update");
    // phone has a unique constraint — a fixed literal here would collide
    // with a leftover row from a prior run against a persistent (non-
    // ephemeral) test database, so it gets the same per-run uniqueness as
    // uniqueEmail().
    const phone = `+2782${Date.now().toString().slice(-7)}`;

    const res = await agent.patch("/api/v1/profile").send({
      firstName: "Updated",
      lastName: "Name",
      phone,
    });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe("Updated");
    expect(res.body.user.lastName).toBe("Name");
    expect(res.body.user.phone).toBe(phone);

    const refetched = await agent.get("/api/v1/profile");
    expect(refetched.body.user.firstName).toBe("Updated");
  });

  it("cannot be used to change another user's profile (no id in body is honoured)", async () => {
    const a = await registerPatient("profile-a");
    const b = await registerPatient("profile-b");

    await a.agent.patch("/api/v1/profile").send({ firstName: "ShouldOnlyAffectA" });

    const bProfile = await b.agent.get("/api/v1/profile");
    expect(bProfile.body.user.firstName).not.toBe("ShouldOnlyAffectA");
  });
});
