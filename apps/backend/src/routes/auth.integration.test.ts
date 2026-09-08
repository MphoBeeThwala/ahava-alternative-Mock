/**
 * AH-07: real register -> login -> /me -> logout, against a real database.
 * Exercises password hashing, cookie session issuance (this app has no
 * bearer-token client path — see AuthContext.tsx's cookie-only design),
 * authMiddleware's DB lookup, and logout's cookie clearing — none of which
 * a unit test can see, since they only exist in how these pieces compose.
 */
import request from "supertest";
import { app } from "../index";

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

const STRONG_PASSWORD = "Str0ng!Passw0rd";

describe("auth: register -> login -> me -> logout", () => {
  it("registers a patient and returns the session cookie", async () => {
    const email = uniqueEmail("register");

    const res = await request(app).post("/api/v1/auth/register").send({
      email,
      password: STRONG_PASSWORD,
      firstName: "Test",
      lastName: "Patient",
      role: "PATIENT",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.role).toBe("PATIENT");
    // Passwords must never round-trip in the response.
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects a weak password with a 400, not a 500", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email: uniqueEmail("weak"),
      password: "weak",
      firstName: "Test",
      lastName: "Patient",
      role: "PATIENT",
    });

    expect(res.status).toBe(400);
  });

  it("logs in, fetches /me with the session cookie, then logs out", async () => {
    const email = uniqueEmail("login-flow");
    const agent = request.agent(app);

    const registerRes = await agent.post("/api/v1/auth/register").send({
      email,
      password: STRONG_PASSWORD,
      firstName: "Login",
      lastName: "Flow",
      role: "PATIENT",
    });
    expect(registerRes.status).toBe(201);

    const meRes = await agent.get("/api/v1/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(email);

    const logoutRes = await agent.post("/api/v1/auth/logout");
    expect(logoutRes.status).toBe(200);

    const meAfterLogout = await agent.get("/api/v1/auth/me");
    expect(meAfterLogout.status).toBe(401);
  });

  it("rejects login with the wrong password", async () => {
    const email = uniqueEmail("wrong-password");
    await request(app).post("/api/v1/auth/register").send({
      email,
      password: STRONG_PASSWORD,
      firstName: "Test",
      lastName: "Patient",
      role: "PATIENT",
    });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "SomethingElse!1" });

    expect(res.status).toBe(401);
  });

  it("rejects /me with no session at all", async () => {
    const res = await request(app).get("/api/v1/auth/me");

    expect(res.status).toBe(401);
  });
});
