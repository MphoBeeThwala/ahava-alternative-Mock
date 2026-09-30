/**
 * Staff onboarding by invitation (docs/ENGINEERING_PLAN.md §41).
 *
 * Nurses, doctors and admins can't sign themselves up. An admin invites one
 * person by email and role; they get a single-use link that expires after
 * INVITE_TTL_HOURS, and registering through it creates exactly that account.
 * This replaced the shared STAFF_REGISTRATION_SECRET / ADMIN_REGISTRATION_SECRET
 * codes: one code for everyone, never expiring, with no record of who used it.
 *
 * Only a SHA-256 hash of the token is stored, so a database read doesn't
 * yield working links. Every invite, resend, revoke and acceptance is audited.
 */
import crypto from 'crypto';
import { StaffInvite, UserRole } from '@prisma/client';
import prisma, { TransactionClient } from '../lib/prisma';
import { addEmailJob } from './queue';

export const INVITE_TTL_HOURS = 48;
export const INVITABLE_ROLES = ['NURSE', 'DOCTOR', 'ADMIN'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];
export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

/**
 * Integration tests that aren't about onboarding register staff directly;
 * only under NODE_ENV=test, like MFA_ENFORCEMENT_DISABLED_FOR_TESTS. There
 * is deliberately no production switch.
 */
export function isStaffInviteRequired(): boolean {
  return !(process.env.NODE_ENV === 'test' && process.env.STAFF_INVITES_DISABLED_FOR_TESTS === 'true');
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

const expiry = () => new Date(Date.now() + INVITE_TTL_HOURS * 3600_000);

export function inviteStatus(invite: Pick<StaffInvite, 'acceptedAt' | 'revokedAt' | 'expiresAt'>, now = new Date()): InviteStatus {
  if (invite.acceptedAt) return 'ACCEPTED';
  if (invite.revokedAt) return 'REVOKED';
  if (invite.expiresAt <= now) return 'EXPIRED';
  return 'PENDING';
}

export function inviteLink(token: string): string {
  const frontend = (process.env.FRONTEND_URL ?? 'https://app.ahavaon88.co.za').replace(/\/+$/, '');
  return `${frontend}/auth/signup?invite=${encodeURIComponent(token)}`;
}

/** Issues a new invite. Any earlier pending invite to the same email stops working. */
export async function createStaffInvite(params: {
  email: string;
  role: InvitableRole;
  firstName?: string | null;
  lastName?: string | null;
  createdById: string;
}): Promise<{ invite: StaffInvite; token: string }> {
  const email = params.email.trim().toLowerCase();
  const { token, tokenHash } = newToken();
  const invite = await prisma.$transaction(async (tx) => {
    await tx.staffInvite.updateMany({
      where: { email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: params.createdById },
    });
    return tx.staffInvite.create({
      data: {
        email,
        role: params.role as UserRole,
        firstName: params.firstName || null,
        lastName: params.lastName || null,
        tokenHash,
        expiresAt: expiry(),
        createdById: params.createdById,
      },
    });
  });
  return { invite, token };
}

/** New link and a fresh expiry for an invite that hasn't been used or revoked; the old link stops working. */
export async function reissueStaffInvite(id: string): Promise<{ invite: StaffInvite; token: string } | null> {
  const { token, tokenHash } = newToken();
  const updated = await prisma.staffInvite.updateMany({
    where: { id, acceptedAt: null, revokedAt: null },
    data: { tokenHash, expiresAt: expiry(), sentCount: { increment: 1 } },
  });
  if (updated.count === 0) return null;
  return { invite: await prisma.staffInvite.findUniqueOrThrow({ where: { id } }), token };
}

/** The invite a link refers to, if it can still be used. */
export async function findUsableInvite(token: string): Promise<StaffInvite | null> {
  if (!token || token.length > 200) return null;
  const invite = await prisma.staffInvite.findUnique({ where: { tokenHash: hashInviteToken(token) } });
  return invite && inviteStatus(invite) === 'PENDING' ? invite : null;
}

/**
 * Marks the invite used, inside the transaction that creates the account.
 * The conditional update means two registrations racing on one link can't
 * both succeed.
 */
export async function consumeInvite(tx: TransactionClient, inviteId: string, userId: string): Promise<boolean> {
  const res = await tx.staffInvite.updateMany({
    where: { id: inviteId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date(), acceptedUserId: userId },
  });
  return res.count === 1;
}

const ROLE_LABEL: Record<InvitableRole, string> = { NURSE: 'nurse', DOCTOR: 'doctor', ADMIN: 'administrator' };

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function sendStaffInviteEmail(invite: StaffInvite, token: string, invitedBy: string): Promise<void> {
  const link = inviteLink(token);
  const role = ROLE_LABEL[invite.role as InvitableRole] ?? 'staff member';
  const greeting = invite.firstName ? `Hi ${invite.firstName},` : 'Hello,';
  const professional = invite.role === 'NURSE'
    ? 'Have your SANC registration number ready. Your account can open patient records once an administrator has verified it.'
    : invite.role === 'DOCTOR'
      ? 'Have your HPCSA registration number ready. Your account can open patient records once an administrator has verified it.'
      : '';
  await addEmailJob({
    to: invite.email,
    subject: `You're invited to join Ahava Healthcare as a ${role}`,
    priority: 1,
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Your Ahava Healthcare invitation</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #334155; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #0f172a;">Your Ahava Healthcare invitation</h2>
  <p>${escapeHtml(greeting)}</p>
  <p>${escapeHtml(invitedBy)} has invited you to create a <strong>${escapeHtml(role)}</strong> account on Ahava Healthcare for ${escapeHtml(invite.email)}.</p>
  <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0d9488;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Create my account</a></p>
  <p style="font-size: 13px;">The link works once and expires in ${INVITE_TTL_HOURS} hours. You'll choose your own password and set up two-factor authentication with an authenticator app. ${escapeHtml(professional)}</p>
  <p style="font-size: 12px; color: #64748b;">Button not working? Paste this into your browser:<br><span style="word-break: break-all;">${escapeHtml(link)}</span></p>
  <p style="font-size: 12px; color: #64748b;">Weren't expecting this? Ignore this email; no account is created unless the link is used. Don't forward it: anyone with the link can use it.</p>
</body></html>`,
    text: `${greeting}\n\n${invitedBy} has invited you to create a ${role} account on Ahava Healthcare for ${invite.email}.\n\nCreate your account: ${link}\n\nThe link works once and expires in ${INVITE_TTL_HOURS} hours. ${professional}\n\nWeren't expecting this? Ignore this email. Don't forward it: anyone with the link can use it.`,
  });
}
