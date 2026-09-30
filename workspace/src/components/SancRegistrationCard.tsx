"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { nurseApi, NurseSanc } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { Card } from './ui/Card';
import { StatusBadge } from './ui/StatusBadge';

const STATUS_TEXT: Record<string, string> = {
    NOT_FOUND: 'Waiting for an administrator to check it on the SANC register.',
    NAME_MISMATCH: 'The name on the SANC register did not match your account. An administrator will check it.',
    EXPIRED: 'Your registration shows as expired. Renew with SANC; an administrator will then check it again.',
    SUSPENDED: 'Your registration shows as suspended. Contact an administrator.',
    CANCELLED: 'Your registration shows as cancelled. Contact an administrator.',
};

/**
 * A nurse's SANC registration: enter or change the number, and see whether
 * it has been verified. Going online and opening visits need it verified.
 */
export default function SancRegistrationCard() {
    const toast = useToast();
    const [sanc, setSanc] = useState<NurseSanc | null>(null);
    const [editing, setEditing] = useState(false);
    const [input, setInput] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            setSanc(await nurseApi.getSanc());
        } catch {
            // The dashboard still works; the card just doesn't show.
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    if (!sanc) return null;
    const verified = sanc.sancVerificationStatus === 'Active';
    const blocked = sanc.sancVerificationStatus === 'SUSPENDED' || sanc.sancVerificationStatus === 'CANCELLED';
    const showForm = !sanc.sancId || editing;

    const save = async () => {
        const value = input.trim();
        if (!value) return;
        if (verified && value.toUpperCase() !== sanc.sancId && !confirm('Changing a verified number takes you offline until an administrator checks the new one. Continue?')) return;
        setSaving(true);
        try {
            const updated = await nurseApi.submitSanc(value);
            setSanc(updated);
            setEditing(false);
            setInput('');
            toast.success(updated.sancVerificationStatus === 'Active' ? 'SANC registration verified.' : 'Number saved. An administrator will check it on the SANC register.');
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Could not save your SANC number.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card padding="sm" style={verified ? undefined : { borderColor: 'var(--warning)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-[var(--foreground)]">SANC registration</p>
                {sanc.sancId && (
                    <StatusBadge variant={verified ? 'success' : blocked ? 'danger' : 'warning'} className="text-xs">
                        {verified ? 'Verified' : blocked ? sanc.sancVerificationStatus : 'Not verified yet'}
                    </StatusBadge>
                )}
            </div>

            {sanc.sancId ? (
                <p className="mt-1 text-sm text-[var(--muted)]">
                    Number <span className="font-mono font-semibold text-[var(--foreground)]">{sanc.sancId}</span>
                    {sanc.sancCategory && <> · {sanc.sancCategory}</>}
                </p>
            ) : (
                <p className="mt-1 text-sm text-[var(--muted)]">
                    Add your SANC registration number. You can go online and see visits once an administrator has verified it.
                </p>
            )}
            {sanc.sancId && !verified && sanc.sancVerificationStatus && (
                <p className="mt-1 text-xs text-[var(--muted)]">{STATUS_TEXT[sanc.sancVerificationStatus] ?? 'Waiting for an administrator to check it.'}</p>
            )}

            {showForm ? (
                <div className="mt-3 flex gap-2">
                    <input
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        maxLength={40}
                        placeholder="e.g. 12345678"
                        aria-label="SANC registration number"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && save()}
                        className="min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-sm"
                        style={{ borderColor: 'var(--border)' }}
                    />
                    <button onClick={save} disabled={saving || !input.trim()} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--primary)' }}>
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                    {editing && (
                        <button onClick={() => { setEditing(false); setInput(''); }} className="rounded-lg border px-3 py-2 text-sm text-[var(--muted)]" style={{ borderColor: 'var(--border)' }}>
                            Cancel
                        </button>
                    )}
                </div>
            ) : !blocked && (
                <button onClick={() => setEditing(true)} className="mt-2 text-xs font-medium text-[var(--primary)] hover:underline">
                    Change number
                </button>
            )}
        </Card>
    );
}
