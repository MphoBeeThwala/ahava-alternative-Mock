/**
 * Signed-in password change (new) and the emailed reset, both of which must
 * sign out every other session — the point of changing a leaked password.
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";

const OLD = "Str0ng!Passw0rd";
const NEW = "N3w!Passw0rd-2026";

async function registerPatient(label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const device1 = request.agent(app);
  const res = await device1.post("/api/v1/auth/register").send({ email, password: OLD, firstName: label, lastName: "Tester", role: "PATIENT" });
  expect(res.status).toBe(201);
  const device2 = request.agent(app);
  expect((await device2.post("/api/v1/auth/login").send({ email, password: OLD })).status).toBe(200);
  return { email, userId: res.body.user.id as string, device1, device2 };
}

describe("changing a password while signed in", () => {
  it("needs the current password and a strong new one", async () => {
    const { device1 } = await registerPatient("pw-validate");
    expect((await device1.post("/api/v1/auth/change-password").send({ currentPassword: "Wrong!Passw0rd", newPassword: NEW })).status).toBe(401);
    expect((await device1.post("/api/v1/auth/change-password").send({ currentPassword: OLD, newPassword: "weak" })).status).toBe(400);
    expect((await device1.post("/api/v1/auth/change-password").send({ currentPassword: OLD, newPassword: OLD })).status).toBe(400);
  });

  it("changes it, signs out other devices, keeps this one signed in, and audits it", async () => {
    const { email, userId, device1, device2 } = await registerPatient("pw-change");

    const res = await device1.post("/api/v1/auth/change-password").send({ currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);

    expect((await device2.post("/api/v1/auth/refresh").send({})).status).toBe(401);
    expect((await device1.post("/api/v1/auth/refresh").send({})).status).toBe(200);
    expect((await request(app).post("/api/v1/auth/login").send({ email, password: OLD })).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/login").send({ email, password: NEW })).status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { userId, action: "PASSWORD_CHANGED" } });
    expect(audit).not.toBeNull();
  });
});

describe("resetting a forgotten password", () => {
  it("signs out every existing session (it used to leave them running)", async () => {
    const { email, userId, device1, device2 } = await registerPatient("pw-reset");
    await request(app).post("/api/v1/auth/forgot-password").send({ email });
    const { passwordResetToken } = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const res = await request(app).post("/api/v1/auth/reset-password").send({ token: passwordResetToken, password: NEW });

    expect(res.status).toBe(200);
    expect((await device1.post("/api/v1/auth/refresh").send({})).status).toBe(401);
    expect((await device2.post("/api/v1/auth/refresh").send({})).status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(0);
    expect(await prisma.auditLog.findFirst({ where: { userId, action: "PASSWORD_RESET" } })).not.toBeNull();
  });
});
