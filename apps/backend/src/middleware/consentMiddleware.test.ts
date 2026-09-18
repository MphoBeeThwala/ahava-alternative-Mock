/**
 * requireConsent gates AI triage (and other consent-scoped features) on an
 * explicit, non-withdrawn PatientConsent record for the exact
 * (userId, consentType, version) tuple — HPCSA telemedicine compliance.
 * Mocks prisma directly: this is pure gate logic, not a DB integration
 * concern (that's covered by the triage integration tests hitting a real
 * database).
 */
import { Response, NextFunction } from 'express';
import { requireConsent } from './consentMiddleware';
import prisma from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    patientConsent: {
      findFirst: jest.fn(),
    },
  },
}));

const mockFindFirst = (prisma as any).patientConsent.findFirst as jest.Mock;

function mockReq(userId?: string) {
  return { user: userId ? { id: userId } : undefined } as any;
}

function mockRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('requireConsent', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects with 401 when there is no authenticated user', async () => {
    const gate = requireConsent('AI_TRIAGE');
    const req = mockReq();
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await gate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('rejects with 403 CONSENT_REQUIRED when no matching consent record exists', async () => {
    mockFindFirst.mockResolvedValue(null);
    const gate = requireConsent('AI_TRIAGE');
    const req = mockReq('patient-1');
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await gate(req, res, next);

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { userId: 'patient-1', consentType: 'AI_TRIAGE', version: '1.0', withdrawn: false },
    });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'CONSENT_REQUIRED', consentType: 'AI_TRIAGE' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the request through when a matching, non-withdrawn consent exists', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'c1',
      userId: 'patient-1',
      consentType: 'AI_TRIAGE',
      version: '1.0',
      withdrawn: false,
    });
    const gate = requireConsent('AI_TRIAGE');
    const req = mockReq('patient-1');
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await gate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks a withdrawn consent (the query itself excludes withdrawn=true, so it is treated as absent)', async () => {
    // withdrawn:false is baked into the where-clause, so a withdrawn consent
    // never comes back from findFirst — this pins that behavior rather than
    // relying on withdrawn records being filtered client-side.
    mockFindFirst.mockResolvedValue(null);
    const gate = requireConsent('AI_TRIAGE');
    const req = mockReq('patient-1');
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await gate(req, res, next);

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ withdrawn: false }) })
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('checks the exact requested consent version, not any version on file', async () => {
    mockFindFirst.mockResolvedValue(null);
    const gate = requireConsent('DATA_SHARING', '2.0');
    const req = mockReq('patient-1');
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await gate(req, res, next);

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { userId: 'patient-1', consentType: 'DATA_SHARING', version: '2.0', withdrawn: false },
    });
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('forwards a database error to next(err) instead of throwing', async () => {
    const dbError = new Error('connection lost');
    mockFindFirst.mockRejectedValue(dbError);
    const gate = requireConsent('AI_TRIAGE');
    const req = mockReq('patient-1');
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await gate(req, res, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });
});
