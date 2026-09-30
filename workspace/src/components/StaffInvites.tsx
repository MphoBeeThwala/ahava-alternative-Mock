"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, StaffInvite } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { StatusBadge } from './ui/StatusBadge';

const ROLE_LABEL: Record<StaffInvite['role'], string> = { NURSE: 'Nurse', DOCTOR: 'Doctor', ADMIN: 'Admin' };
const STATUS_VARIANT = { PENDING: 'warning', ACCEPTED: 'success', EXPIRED: 'danger', REVOKED: 'danger' } as const;

const when = (iso: string) => new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Shown once, right after an invite is sent or resent. The link also went by
 * email; this is for when it doesn't arrive.
 */
export function InviteLinkNotice({ email, link, onClose }: { email: string; link: string; onClose?: () => void }) {
    const toast = useToast();
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(link);
            toast.success('Link copied.');
        } catch {
            toast.error('Could not copy. Select the link and copy it manually.');
        }
    };
    return (
        <div className="rounded-xl border p-4 text-sm" style={{ borderColor: '#99f6e4', background: '#f0fdfa' }}>
            <p className="font-semibold text-[#0f766e]">Invite emailed to {email}.</p>
            <p className="mt-1 text-[var(--muted)]">
                If it doesn&apos;t arrive, send them this link yourself, privately (not in a group chat). It works once and expires in 48 hours.
                You won&apos;t see it again after closing this.
            </p>
            <div className="mt-3 flex gap-2">
                <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 font-mono text-xs" style={{ borderColor: 'var(--border)' }} />
                <button type="button" onClick={copy} className="rounded-lg px-3 py-2 text-xs font-semibold text-white" style={{ backgroundColor: '#0d9488' }}>Copy</button>
                {onClose && <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-xs font-semibold text-[var(--muted)]" style={{ borderColor: 'var(--border)' }}>Done</button>}
            </div>
        </div>
    );
}

export default function StaffInvites({ refreshKey }: { refreshKey: number }) {
    const toast = useToast();
    const [invites, setInvites] = useState<StaffInvite[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [shownLink, setShownLink] = useState<{ email: string; link: string } | null>(null);
    const [showAll, setShowAll] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setInvites(await adminApi.listInvites());
        } catch {
            toast.error('Failed to load invites.');
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { load(); }, [load, refreshKey]);

    const resend = async (invite: StaffInvite) => {
        setBusy(invite.id);
        try {
            const res = await adminApi.resendInvite(invite.id);
            setShownLink({ email: invite.email, link: res.inviteLink });
            toast.success(`New invite sent to ${invite.email}. The previous link no longer works.`);
            load();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to resend invite.');
        } finally {
            setBusy(null);
        }
    };

    const revoke = async (invite: StaffInvite) => {
        if (!confirm(`Cancel the invite for ${invite.email}? The link will stop working.`)) return;
        setBusy(invite.id);
        try {
            await adminApi.revokeInvite(invite.id);
            toast.success('Invite cancelled.');
            load();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to cancel invite.');
        } finally {
            setBusy(null);
        }
    };

    const visible = showAll ? invites : invites.filter((i) => i.status === 'PENDING' || i.status === 'EXPIRED');

    return (
        <Card className="mt-6 overflow-hidden p-0">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 border-b p-6" style={{ borderColor: 'var(--border)' }}>
                <div>
                    <CardTitle className="mb-0">Staff invites</CardTitle>
                    <p className="mt-1 text-xs text-[var(--muted)]">Nurses, doctors and admins join only through an invite. Each link works once, for one email, and expires after 48 hours.</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
                    <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                    Show accepted and cancelled
                </label>
            </CardHeader>

            {shownLink && (
                <div className="p-6 pb-0">
                    <InviteLinkNotice email={shownLink.email} link={shownLink.link} onClose={() => setShownLink(null)} />
                </div>
            )}

            {loading && invites.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--muted)]">Loading invites…</div>
            ) : visible.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--muted)]">{showAll ? 'No invites yet.' : 'No outstanding invites.'}</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="font-medium text-[var(--muted)]" style={{ backgroundColor: 'var(--background)' }}>
                                <th className="p-4">Email</th>
                                <th className="p-4">Role</th>
                                <th className="p-4">Status</th>
                                <th className="p-4">Invited</th>
                                <th className="p-4">Expires</th>
                                <th className="p-4">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                            {visible.map((i) => (
                                <tr key={i.id}>
                                    <td className="p-4">
                                        <div className="font-medium text-[var(--foreground)]">{i.email}</div>
                                        {(i.firstName || i.lastName) && <div className="text-xs text-[var(--muted)]">{[i.firstName, i.lastName].filter(Boolean).join(' ')}</div>}
                                    </td>
                                    <td className="p-4">{ROLE_LABEL[i.role]}</td>
                                    <td className="p-4">
                                        <StatusBadge variant={STATUS_VARIANT[i.status]} className="text-xs">
                                            {i.status === 'REVOKED' ? 'CANCELLED' : i.status}
                                        </StatusBadge>
                                    </td>
                                    <td className="p-4 text-[var(--muted)]">
                                        {when(i.createdAt)}
                                        {i.invitedBy && <div className="text-xs">by {i.invitedBy}</div>}
                                    </td>
                                    <td className="p-4 text-[var(--muted)]">{i.status === 'ACCEPTED' && i.acceptedAt ? `Joined ${when(i.acceptedAt)}` : when(i.expiresAt)}</td>
                                    <td className="p-4">
                                        {(i.status === 'PENDING' || i.status === 'EXPIRED') && (
                                            <>
                                                <button onClick={() => resend(i)} disabled={busy === i.id} className="text-sm font-medium text-[var(--primary)] hover:underline disabled:opacity-50">
                                                    {i.status === 'EXPIRED' ? 'Send new link' : 'Resend'}
                                                </button>
                                                <button onClick={() => revoke(i)} disabled={busy === i.id} className="ml-3 text-sm font-medium hover:underline disabled:opacity-50" style={{ color: 'var(--danger)' }}>
                                                    Cancel
                                                </button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
}
