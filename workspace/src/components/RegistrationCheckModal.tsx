"use client";

import React, { useState } from 'react';
import { adminApi, SancRegisterFinding, User } from '../lib/api';
import { useToast } from '../contexts/ToastContext';

// The councils' own public registers. Admins look the number up there.
const REGISTER = {
    HPCSA: { name: 'HPCSA iRegister', url: 'https://hpcsaonline.custhelp.com/app/i_reg_form' },
    SANC: { name: "SANC's online registration check", url: 'https://www.sanc.co.za/' },
} as const;

const SANC_FINDINGS: Array<{ value: SancRegisterFinding; label: string }> = [
    { value: 'ACTIVE', label: 'Active, and the name matches' },
    { value: 'NOT_FOUND', label: 'Not found on the register' },
    { value: 'NAME_MISMATCH', label: 'Found, but under a different name' },
    { value: 'EXPIRED', label: 'Expired / lapsed' },
    { value: 'SUSPENDED', label: 'Suspended' },
    { value: 'CANCELLED', label: 'Cancelled / removed' },
];

const BLOCKING = ['SUSPENDED', 'CANCELLED'];

/**
 * An admin records what the council's register showed for a nurse's SANC
 * number or a doctor's HPCSA number, with a note of what was checked. The
 * note goes to the audit log.
 */
export default function RegistrationCheckModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
    const toast = useToast();
    const body = user.role === 'NURSE' ? 'SANC' : 'HPCSA';
    const number = body === 'SANC' ? user.sancId : user.hcpsaNumber;
    const currentlyBlocked = body === 'SANC' && BLOCKING.includes(user.sancVerificationStatus ?? '');

    const [finding, setFinding] = useState<SancRegisterFinding>('ACTIVE');
    const [hpcsaVerify, setHpcsaVerify] = useState(true);
    const [note, setNote] = useState('');
    const [confirmChange, setConfirmChange] = useState(false);
    const [saving, setSaving] = useState(false);

    const approving = body === 'SANC' ? finding === 'ACTIVE' : hpcsaVerify;
    const needsConfirm = currentlyBlocked && approving;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            if (body === 'SANC') {
                await adminApi.recordSancCheck(user.id, { finding, note: note.trim(), ...(needsConfirm ? { confirmStatusChange: confirmChange } : {}) });
            } else {
                await adminApi.setDoctorHpcsa(user.id, hpcsaVerify, note.trim());
            }
            toast.success(approving ? `${body} registration verified.` : `${body} check recorded; ${user.firstName} is not verified.`);
            onSaved();
            onClose();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Could not record the check.');
        } finally {
            setSaving(false);
        }
    };

    const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
            <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 520, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
                <div style={{ background: 'linear-gradient(135deg,#0d9488,#059669)', padding: '20px 28px', color: 'white' }}>
                    <h3 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>Record {body} register check</h3>
                    <p style={{ margin: '4px 0 0', opacity: 0.85, fontSize: 13 }}>
                        {user.firstName} {user.lastName} · {body} number <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{number}</span>
                    </p>
                </div>

                <form onSubmit={submit} style={{ padding: 28 }}>
                    <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
                        Look the number up on{' '}
                        <a href={REGISTER[body].url} target="_blank" rel="noopener noreferrer" style={{ color: '#0d9488', fontWeight: 600 }}>{REGISTER[body].name}</a>
                        {' '}and check the name and status match this person. Then record what it showed.
                    </p>

                    <div style={{ marginBottom: 16 }}>
                        <label style={label} htmlFor="reg-finding">The register shows</label>
                        {body === 'SANC' ? (
                            <select id="reg-finding" value={finding} onChange={(e) => { setFinding(e.target.value as SancRegisterFinding); setConfirmChange(false); }} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: 'white' }}>
                                {SANC_FINDINGS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                            </select>
                        ) : (
                            <select id="reg-finding" value={hpcsaVerify ? 'yes' : 'no'} onChange={(e) => setHpcsaVerify(e.target.value === 'yes')} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: 'white' }}>
                                <option value="yes">Registered as a medical practitioner, active, and the name matches</option>
                                <option value="no">Not found, not active, or the name doesn&apos;t match</option>
                            </select>
                        )}
                    </div>

                    {needsConfirm && (
                        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16, padding: 12, borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 13, color: '#991b1b' }}>
                            <input type="checkbox" checked={confirmChange} onChange={(e) => setConfirmChange(e.target.checked)} style={{ marginTop: 3 }} />
                            <span>
                                This registration is flagged <strong>{user.sancVerificationStatus}</strong>. I have checked SANC&apos;s register today and it now shows the registration as active.
                            </span>
                        </label>
                    )}

                    <div style={{ marginBottom: 20 }}>
                        <label style={label} htmlFor="reg-note">What you checked</label>
                        <textarea
                            id="reg-note"
                            required
                            minLength={10}
                            maxLength={1000}
                            rows={3}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder={body === 'SANC' ? 'e.g. SANC register checked 30 Sep: Professional Nurse, active, name matches' : 'e.g. iRegister checked 30 Sep: MP, active, name matches'}
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }}
                        />
                        <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>Saved to the audit log with your name and the time.</p>
                    </div>

                    <div style={{ display: 'flex', gap: 12 }}>
                        <button type="button" onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1.5px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                        <button
                            type="submit"
                            disabled={saving || note.trim().length < 10 || (needsConfirm && !confirmChange)}
                            style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: saving ? '#94a3b8' : approving ? 'linear-gradient(135deg,#0d9488,#059669)' : '#dc2626', color: 'white', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: note.trim().length < 10 || (needsConfirm && !confirmChange) ? 0.6 : 1 }}
                        >
                            {saving ? 'Saving…' : approving ? 'Verify' : 'Record: not verified'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
