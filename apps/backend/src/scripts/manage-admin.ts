/**
 * Infrastructure-level recovery for the admin account — for when nobody can
 * sign in as an admin (lost password, or the only admin lost their 2FA
 * device, so there is no second admin to reset it in the app). Needs the
 * database owner connection, i.e. access to the hosting platform itself.
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD='<new strong password>' pnpm tsx src/scripts/manage-admin.ts
 *   ADMIN_EMAIL=... pnpm tsx src/scripts/manage-admin.ts --reset-2fa
 *   ADMIN_EMAIL=... pnpm tsx src/scripts/manage-admin.ts --invite
 *
 * --invite is for when there is no admin account to recover (a new
 * deployment, or every admin has left): it issues a single-use admin invite
 * for ADMIN_EMAIL and prints the link. Admins invite everyone else from the
 * dashboard (services/staffInvites.ts).
 *
 * There are deliberately no default credentials: this file previously held
 * a real-looking admin email and password as fallbacks, committed to the
 * repository (docs/ENGINEERING_PLAN.md §39).
 */
import * as bcrypt from '@node-rs/bcrypt';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { writeRequestAudit } from '../services/clinicalAudit';
import { revokeAllSessions } from '../services/sessions';
import { createStaffInvite, INVITE_TTL_HOURS, inviteLink, sendStaffInviteEmail } from '../services/staffInvites';

async function inviteAdmin(adminEmail: string) {
  if (await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } })) {
    throw new Error(`An account with email ${adminEmail} already exists; recover it instead of inviting.`);
  }
  const { invite, token } = await createStaffInvite({ email: adminEmail, role: 'ADMIN', createdById: 'infrastructure:manage-admin' });
  await writeRequestAudit({
    userId: null,
    userRole: 'SYSTEM',
    action: 'CREATE',
    resource: 'StaffInvite',
    resourceId: invite.id,
    metadata: { event: 'INVITE_SENT', role: 'ADMIN', email: adminEmail, via: 'manage-admin' },
  });
  await sendStaffInviteEmail(invite, token, 'The Ahava Healthcare platform team').catch(() => {});
  console.log(`Admin invite issued for ${adminEmail} (expires in ${INVITE_TTL_HOURS} hours). It was also emailed if email is configured.`);
  console.log(`Link (single use; give it only to that person): ${inviteLink(token)}`);
}

async function manageAdmin() {
  const resetTwoFactor = process.argv.includes('--reset-2fa');
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail) throw new Error('Set ADMIN_EMAIL to the admin account to recover.');
  if (process.argv.includes('--invite')) return inviteAdmin(adminEmail);
  if (!resetTwoFactor && (!adminPassword || adminPassword.length < 12)) {
    throw new Error('Set ADMIN_PASSWORD to a new password of at least 12 characters (or pass --reset-2fa).');
  }

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', email: adminEmail } });
  if (!admin) throw new Error(`No admin account with email ${adminEmail}.`);

  const data: Record<string, unknown> = { isActive: true };
  if (adminPassword && !resetTwoFactor) data.passwordHash = await bcrypt.hash(adminPassword, 12);
  if (resetTwoFactor) Object.assign(data, { totpEnabled: false, totpSecret: null, totpBackupCodes: [] });

  await prisma.user.update({ where: { id: admin.id }, data });
  // Existing sessions end either way (database and Redis).
  await revokeAllSessions(admin.id);
  await writeRequestAudit({
    userId: admin.id,
    userRole: 'ADMIN',
    action: 'UPDATE',
    resource: 'AdminAction',
    resourceId: admin.id,
    metadata: { entity: 'InfrastructureRecovery', passwordReset: !resetTwoFactor, twoFactorReset: resetTwoFactor },
  });

  console.log(resetTwoFactor
    ? `Two-factor authentication reset for ${adminEmail}. They must set it up again at next sign-in.`
    : `Password reset for ${adminEmail}. All their sessions were signed out.`);
}

manageAdmin()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
