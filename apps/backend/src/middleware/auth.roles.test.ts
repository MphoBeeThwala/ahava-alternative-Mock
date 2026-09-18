/**
 * RBAC matrix for the role gates actually wired into routes
 * (requireAdmin/requireDoctor/requireNurse/requirePatient, all built on
 * requireRole in auth.ts — the standalone middleware/requireRole.ts is not
 * imported by any route and is not what's enforcing access).
 *
 * Synchronous, DB-free: these gates only inspect req.user, set upstream by
 * authMiddleware, so a plain mock req/res/next is enough — no need for the
 * real database or a token.
 */
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import {
  AuthenticatedRequest,
  requireRole,
  requireAdmin,
  requireDoctor,
  requireNurse,
  requirePatient,
} from './auth';

function mockReq(role?: UserRole): AuthenticatedRequest {
  return (role
    ? { user: { id: 'u1', email: 'u@example.test', role, isActive: true } }
    : {}) as AuthenticatedRequest;
}

function mockRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('RBAC: requireRole and role-specific gates', () => {
  it('rejects with 401 when no user is attached to the request', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the user role is not in the allowed set', () => {
    const req = mockReq(UserRole.PATIENT);
    const res = mockRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the matching role through to next()', () => {
    const req = mockReq(UserRole.ADMIN);
    const res = mockRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  // ADMIN is folded into every role-specific gate (requireDoctor,
  // requireNurse, requirePatient) by construction in auth.ts — pin that
  // down explicitly since it's easy to regress silently.
  describe.each([
    ['requireDoctor', requireDoctor, [UserRole.DOCTOR, UserRole.ADMIN], [UserRole.PATIENT, UserRole.NURSE]],
    ['requireNurse', requireNurse, [UserRole.NURSE, UserRole.ADMIN], [UserRole.PATIENT, UserRole.DOCTOR]],
    ['requirePatient', requirePatient, [UserRole.PATIENT, UserRole.ADMIN], [UserRole.NURSE, UserRole.DOCTOR]],
  ] as const)('%s', (_name, gate, allowed, disallowed) => {
    it.each(allowed)('allows role %s', (role) => {
      const req = mockReq(role);
      const res = mockRes();
      const next = jest.fn();

      gate(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it.each(disallowed)('rejects role %s with 403 (no privilege escalation)', (role) => {
      const req = mockReq(role);
      const res = mockRes();
      const next = jest.fn();

      gate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  it('requireRole with an empty role list rejects every authenticated user', () => {
    const gate = requireRole([]);
    const req = mockReq(UserRole.ADMIN);
    const res = mockRes();
    const next = jest.fn();

    gate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
