/**
 * Staff sign-up by single-use invite (services/staffInvites.ts). Other
 * suites register staff directly (testSetup/globalSetup.js); this one turns
 * the invite requirement back on.
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";
import * as staffInvites from "./staffInvites";

const STRONG_PASSWORD = "Str0ng!Passw0rd";
const previous = process.env.STAFF_INVITES_DISABLED_FOR_TESTS;
let emailSpy: jest.SpyInstance;

beforeAll(() => {
  process.env.STAFF_INVITES_DISABLED_FOR_TESTS = "false";
});
afterAll(() => {
  process.env.STAFF_INVITES_DISABLED_FOR_TESTS = previous;
});
beforeEach(() => {
  emailSpy = jest.spyOn(staffInvites, "sendStaffInviteEmail").mockResolvedValue();
});
afterEach(() => emailSpy.mockRestore());

const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
const tokenFrom = (link: string) => new URL(link).searchParams.get("invite")!;

function registerWith(body: Record<string, unknown>) {
  const agent = request.agent(app);
  return { agent, res: agent.post("/api/v1/auth/register").send({ password: STRONG_PASSWORD, firstName: "Invited", lastName: "Person", ...body }) };
}

/** An admin, onboarded the only way there is: an invite (as issued by scripts/manage-admin.ts --invite). */
async function admin() {
  const email = uniqueEmail("invite-admin");
  const { token } = await staffInvites.createStaffInvite({ email, role: "ADMIN", createdById: "infrastructure:test" });
  const { agent, res } = registerWith({ email, role: "ADMIN", inviteToken: token });
  expect((await res).status).toBe(201);
  return agent;
}

async function invite(adminAgent: ReturnType<typeof request.agent>, role: "NURSE" | "DOCTOR" | "ADMIN", extra: Record<string, unknown> = {}) {
  const email = uniqueEmail(`invitee-${role.toLowerCase()}`);
  const res = await adminAgent.post("/api/v1/admin/invites").send({ email, role, firstName: "Thandi", lastName: "Mokoena", ...extra });
  expect(res.status).toBe(201);
  return { email, id: res.body.invite.id as string, token: tokenFrom(res.body.inviteLink) };
}

describe("staff sign-up requires an invite", () => {
  it.each(["NURSE", "DOCTOR", "ADMIN"] as const)("refuses %s sign-up without one, whatever secret is sent", async (role) => {
    const email = uniqueEmail("no-invite");
    const res = await request(app).post("/api/v1/auth/register").send({
      email, password: STRONG_PASSWORD, firstName: "No", lastName: "Invite", role, adminSecret: "the-old-shared-code",
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INVITE_REQUIRED");
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("still lets patients sign up freely, including from an old page that sends an empty secret", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email: uniqueEmail("patient"), password: STRONG_PASSWORD, firstName: "Pat", lastName: "Ient", role: "PATIENT", adminSecret: "",
    });
    expect(res.status).toBe(201);
  });
});

describe("the invite flow", () => {
  it("admin invites a nurse; the link shows who it's for, creates exactly that account, and works once", async () => {
    const adminAgent = await admin();
    const { email, id, token } = await invite(adminAgent, "NURSE");

    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(emailSpy.mock.calls[0][0].email).toBe(email);
    // Only a hash of the token is stored.
    const row = await prisma.staffInvite.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);

    const lookup = await request(app).get(`/api/v1/auth/invites/${token}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.invite).toMatchObject({ email, role: "NURSE", firstName: "Thandi" });

    const { res } = registerWith({ email, role: "NURSE", inviteToken: token, sancRegistrationNumber: "12345678" });
    const created = await res;
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({ email, role: "NURSE", isVerified: true });

    const accepted = await prisma.staffInvite.findUniqueOrThrow({ where: { id } });
    expect(accepted.acceptedUserId).toBe(created.body.user.id);
    const list = await adminAgent.get("/api/v1/admin/invites");
    expect(list.body.invites.find((i: any) => i.id === id).status).toBe("ACCEPTED");
    const audit = await prisma.auditLog.findFirst({ where: { resource: "StaffInvite", resourceId: id, userId: created.body.user.id } });
    expect((audit!.metadata as any).event).toBe("INVITE_ACCEPTED");

    const again = await registerWith({ email: uniqueEmail("reuse"), role: "NURSE", inviteToken: token }).res;
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("INVITE_INVALID");
    expect((await request(app).get(`/api/v1/auth/invites/${token}`)).status).toBe(404);
  });

  it("stores a doctor's HPCSA number unverified, for an admin to check", async () => {
    const { email, token } = await invite(await admin(), "DOCTOR");

    const res = await registerWith({ email, role: "DOCTOR", inviteToken: token, hpcsaNumber: "MP0123456" }).res;

    expect(res.status).toBe(201);
    const doctor = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(doctor.hcpsaNumber).toBe("MP0123456");
    expect(doctor.hcpsaVerified).toBe(false);
  });

  it("won't let the link be used for another email or another role", async () => {
    const { email, token } = await invite(await admin(), "NURSE");

    const otherEmail = await registerWith({ email: uniqueEmail("someone-else"), role: "NURSE", inviteToken: token }).res;
    const otherRole = await registerWith({ email, role: "ADMIN", inviteToken: token }).res;

    expect(otherEmail.status).toBe(400);
    expect(otherRole.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("rejects expired and revoked links", async () => {
    const adminAgent = await admin();
    const expired = await invite(adminAgent, "NURSE");
    await prisma.staffInvite.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const revoked = await invite(adminAgent, "DOCTOR");
    expect((await adminAgent.post(`/api/v1/admin/invites/${revoked.id}/revoke`).send({})).status).toBe(200);

    expect((await registerWith({ email: expired.email, role: "NURSE", inviteToken: expired.token }).res).status).toBe(400);
    expect((await registerWith({ email: revoked.email, role: "DOCTOR", inviteToken: revoked.token }).res).status).toBe(400);
    const list = (await adminAgent.get("/api/v1/admin/invites")).body.invites;
    expect(list.find((i: any) => i.id === expired.id).status).toBe("EXPIRED");
    expect(list.find((i: any) => i.id === revoked.id).status).toBe("REVOKED");
  });

  it("resending issues a new link with a fresh expiry, and the old link stops working", async () => {
    const adminAgent = await admin();
    const first = await invite(adminAgent, "NURSE");
    await prisma.staffInvite.update({ where: { id: first.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const resent = await adminAgent.post(`/api/v1/admin/invites/${first.id}/resend`).send({});
    expect(resent.status).toBe(200);
    expect(resent.body.invite.status).toBe("PENDING");
    expect(resent.body.invite.sentCount).toBe(2);
    const newToken = tokenFrom(resent.body.inviteLink);

    expect((await request(app).get(`/api/v1/auth/invites/${first.token}`)).status).toBe(404);
    expect((await registerWith({ email: first.email, role: "NURSE", inviteToken: newToken }).res).status).toBe(201);
    expect((await adminAgent.post(`/api/v1/admin/invites/${first.id}/resend`).send({})).status).toBe(404);
  });

  it("a new invite to the same email replaces the earlier one; an existing account can't be invited", async () => {
    const adminAgent = await admin();
    const first = await invite(adminAgent, "NURSE");
    const second = await adminAgent.post("/api/v1/admin/invites").send({ email: first.email, role: "DOCTOR" });
    expect(second.status).toBe(201);

    expect((await request(app).get(`/api/v1/auth/invites/${first.token}`)).status).toBe(404);
    expect((await registerWith({ email: first.email, role: "DOCTOR", inviteToken: tokenFrom(second.body.inviteLink) }).res).status).toBe(201);

    const existing = await adminAgent.post("/api/v1/admin/invites").send({ email: first.email, role: "NURSE" });
    expect(existing.status).toBe(409);
  });

  it("only admins can invite, and patients can't be invited", async () => {
    const patient = request.agent(app);
    await patient.post("/api/v1/auth/register").send({ email: uniqueEmail("pt"), password: STRONG_PASSWORD, firstName: "Pat", lastName: "Ient", role: "PATIENT" });

    expect((await patient.post("/api/v1/admin/invites").send({ email: uniqueEmail("x"), role: "NURSE" })).status).toBe(403);
    expect((await (await admin()).post("/api/v1/admin/invites").send({ email: uniqueEmail("x"), role: "PATIENT" })).status).toBe(400);
  });

  it("an invite can be used up only once, even by two registrations at the same moment", async () => {
    const adminAgent = await admin();
    const { id } = await invite(adminAgent, "NURSE");
    const [a, b] = await Promise.all([
      prisma.$transaction((tx) => staffInvites.consumeInvite(tx, id, "user-a")),
      prisma.$transaction((tx) => staffInvites.consumeInvite(tx, id, "user-b")),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});
