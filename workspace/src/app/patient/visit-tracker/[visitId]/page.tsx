"use client";

import React, { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import RoleGuard, { UserRole } from '../../../../components/RoleGuard';
import DashboardLayout from '../../../../components/DashboardLayout';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import { visitsApi, bookingsApi } from '../../../../lib/api';
import { useVisitWebSocket } from '../../../../hooks/useVisitWebSocket';

const STATUS_STEPS = [
  { key: 'SCHEDULED',   label: 'Booked',       icon: '✅', desc: 'Your nurse has been assigned' },
  { key: 'EN_ROUTE',    label: 'En Route',      icon: '🚗', desc: 'Your nurse is on the way' },
  { key: 'ARRIVED',     label: 'Arrived',       icon: '📍', desc: 'Your nurse is at your door' },
  { key: 'IN_PROGRESS', label: 'In Progress',   icon: '🩺', desc: 'Your visit is underway' },
  { key: 'COMPLETED',   label: 'Completed',     icon: '🎉', desc: 'Visit complete — feel better soon!' },
];

const STATUS_ORDER = ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];

interface VisitData {
  id: string;
  bookingId: string;
  status: string;
  scheduledStart?: string;
  actualStart?: string;
  actualEnd?: string;
  nurse?: { id: string; firstName: string; lastName: string; email?: string };
  booking?: {
    encryptedAddress?: string;
    scheduledDate?: string;
    estimatedDuration?: number;
    amountInCents?: number;
    patient?: { firstName?: string; lastName?: string };
  };
}

export default function VisitTrackerPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = use(params);
  const router = useRouter();
  const { token } = useAuth();
  const toast = useToast();

  const [visit, setVisit] = useState<VisitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const { lastMessage, connected } = useVisitWebSocket(token);

  const loadVisit = useCallback(async () => {
    try {
      const data = await visitsApi.getById(visitId);
      setVisit(data.visit ?? data);
    } catch {
      toast.error('Unable to load visit details.');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  useEffect(() => {
    loadVisit();
    // Poll every 15s as fallback
    const interval = setInterval(loadVisit, 15000);
    return () => clearInterval(interval);
  }, [visitId, loadVisit]);

  // Handle real-time WS updates
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'VISIT_STATUS_CHANGED') {
      const d = lastMessage.data as { visitId?: string; status?: string };
      if (d.visitId === visitId && d.status) {
        setVisit((v) => v ? { ...v, status: d.status! } : v);
      }
    }

    if (lastMessage.type === 'NURSE_LOCATION_UPDATE') {
      const d = lastMessage.data as { visitId?: string };
      if (d.visitId === visitId) {
        loadVisit();
      }
    }
  }, [lastMessage, visitId, loadVisit]);

  const handleCancel = async () => {
    if (!visit?.bookingId) return;
    if (!confirm('Cancel this visit request? This cannot be undone.')) return;
    setCancelling(true);
    try {
      await bookingsApi.cancel(visit.bookingId);
      toast.success('Visit cancelled.');
      router.push('/patient/dashboard');
    } catch {
      toast.error('Failed to cancel. Please contact support.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <RoleGuard allowedRoles={[UserRole.PATIENT]}>
        <DashboardLayout>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid #0d9488', borderTopColor: 'transparent', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <p style={{ color: 'var(--muted)', fontWeight: 600 }}>Loading visit…</p>
            </div>
          </div>
        </DashboardLayout>
      </RoleGuard>
    );
  }

  if (!visit) {
    return (
      <RoleGuard allowedRoles={[UserRole.PATIENT]}>
        <DashboardLayout>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 16 }}>
            <span style={{ fontSize: 48 }}>🔍</span>
            <p style={{ fontWeight: 700, color: 'var(--foreground)' }}>Visit not found</p>
            <button onClick={() => router.push('/patient/dashboard')} style={{ padding: '10px 24px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Back to Dashboard</button>
          </div>
        </DashboardLayout>
      </RoleGuard>
    );
  }

  const currentIdx = STATUS_ORDER.indexOf(visit.status);
  const isCancelled = visit.status === 'CANCELLED';
  const isCompleted = visit.status === 'COMPLETED';
  const canCancel = visit.status === 'SCHEDULED';

  const duration = visit.booking?.estimatedDuration ?? 60;
  const price = visit.booking?.amountInCents ? `R${(visit.booking.amountInCents / 100).toFixed(0)}` : '—';
  const scheduledAt = visit.booking?.scheduledDate
    ? new Date(visit.booking.scheduledDate).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  return (
    <RoleGuard allowedRoles={[UserRole.PATIENT]}>
      <DashboardLayout>
        <div style={{ background: 'var(--background)', minHeight: '100vh' }}>

          {/* Hero */}
          <div style={{ background: isCancelled ? 'linear-gradient(135deg,#1f2937,#374151)' : isCompleted ? 'linear-gradient(135deg,#064e3b,#047857)' : 'linear-gradient(135deg,#0a1628,#0d2f5e,#0a3d3a)', padding: '28px 40px 24px', position: 'relative', overflow: 'hidden', transition: 'background 0.5s' }}>
            <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,255,255,0.06),transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <p style={{ color: 'rgba(94,234,212,0.8)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Live Visit Tracker</p>
                <h1 style={{ color: 'white', fontSize: 'clamp(18px,3vw,26px)', fontWeight: 900, margin: 0 }}>
                  {isCancelled ? '❌ Visit Cancelled' : isCompleted ? '🎉 Visit Completed' : `🏠 Visit in Progress`}
                </h1>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 4 }}>{scheduledAt} · {duration} min</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '8px 14px' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#34d399' : '#6b7280', boxShadow: connected ? '0 0 6px #34d399' : 'none' }} />
                <span style={{ fontSize: 12, color: 'white', fontWeight: 600 }}>{connected ? 'Live updates' : 'Reconnecting…'}</span>
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 700, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* Status stepper */}
            {!isCancelled && (
              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 20, padding: '28px 24px', boxShadow: 'var(--shadow)' }}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 24 }}>Visit Status</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {STATUS_STEPS.map((step, i) => {
                    const done = i < currentIdx;
                    const active = i === currentIdx;
                    const pending = i > currentIdx;
                    return (
                      <div key={step.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, paddingBottom: i < STATUS_STEPS.length - 1 ? 24 : 0, position: 'relative' }}>
                        {/* Connector line */}
                        {i < STATUS_STEPS.length - 1 && (
                          <div style={{ position: 'absolute', left: 19, top: 40, width: 2, height: 'calc(100% - 40px)', background: done ? '#059669' : 'var(--border)', borderRadius: 2 }} />
                        )}
                        {/* Step icon */}
                        <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: active ? 20 : 17, background: done ? '#059669' : active ? 'linear-gradient(135deg,#0d9488,#059669)' : 'var(--background)', border: `2px solid ${done || active ? 'transparent' : 'var(--border)'}`, boxShadow: active ? '0 0 0 4px rgba(13,148,136,0.2)' : 'none', transition: 'all 0.3s' }}>
                          {done ? '✓' : step.icon}
                        </div>
                        {/* Text */}
                        <div style={{ paddingTop: 8 }}>
                          <p style={{ fontSize: 14, fontWeight: active ? 800 : 600, color: pending ? 'var(--muted)' : 'var(--foreground)', margin: 0 }}>{step.label}</p>
                          {active && <p style={{ fontSize: 12, color: '#0d9488', marginTop: 2, fontWeight: 600 }}>{step.desc}</p>}
                        </div>
                        {active && (
                          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(13,148,136,0.1)', borderRadius: 20, padding: '4px 12px' }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#0d9488', animation: 'pulse 1.5s ease-in-out infinite' }} />
                            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#0d9488' }}>NOW</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Nurse info card */}
            {visit.nurse && (
              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 20, padding: '20px 24px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,#059669,#047857)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 20, fontWeight: 800, flexShrink: 0 }}>
                  {visit.nurse.firstName[0]}{visit.nurse.lastName[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--foreground)', margin: 0 }}>
                      {visit.nurse.firstName} {visit.nurse.lastName}
                    </p>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: 'rgba(5,150,105,0.1)', color: '#059669' }}>🟢 SANC Verified</span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>Your assigned nurse · {price} · {duration} min</p>
                </div>
              </div>
            )}

            {/* Visit details card */}
            <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 20, padding: '20px 24px', boxShadow: 'var(--shadow)' }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Visit Details</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
                <div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Scheduled</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{scheduledAt}</p>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Duration</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{duration} min</p>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Amount</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#059669' }}>{price}</p>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Address</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', wordBreak: 'break-word' }}>{visit.booking?.encryptedAddress ?? '—'}</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={() => router.push('/patient/dashboard')}
                style={{ flex: 1, minWidth: 140, padding: '13px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'white', fontSize: 14, fontWeight: 600, color: 'var(--foreground)', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                ← Dashboard
              </button>
              {canCancel && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  style={{ flex: 1, minWidth: 140, padding: '13px', borderRadius: 12, border: '1.5px solid #ef4444', background: 'rgba(239,68,68,0.06)', fontSize: 14, fontWeight: 600, color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', opacity: cancelling ? 0.6 : 1 }}
                >
                  {cancelling ? 'Cancelling…' : '✕ Cancel Visit'}
                </button>
              )}
            </div>

          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
