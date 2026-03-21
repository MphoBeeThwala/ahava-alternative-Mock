"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import DashboardLayout from '../../../components/DashboardLayout';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { bookingsApi } from '../../../lib/api';
import { useVisitWebSocket } from '../../../hooks/useVisitWebSocket';

const SERVICES = [
  { id: 'general', label: 'General Check-up', icon: '🩺', desc: 'Vitals, health assessment' },
  { id: 'wound', label: 'Wound Care', icon: '🩹', desc: 'Dressing, irrigation, monitoring' },
  { id: 'bp', label: 'Blood Pressure', icon: '💉', desc: 'BP monitoring & management' },
  { id: 'meds', label: 'Medication Admin', icon: '💊', desc: 'IV, injections, oral meds' },
  { id: 'post_op', label: 'Post-Surgery Care', icon: '🏥', desc: 'Recovery monitoring' },
  { id: 'pain', label: 'Pain Assessment', icon: '❤️‍🩹', desc: 'Pain evaluation & management' },
];

const DURATIONS = [
  { value: 30,  label: '30 min', price: 35000 },
  { value: 60,  label: '1 hour', price: 50000 },
  { value: 90,  label: '1.5 hrs', price: 70000 },
  { value: 120, label: '2 hours', price: 90000 },
];

type Step = 'form' | 'locating' | 'searching' | 'found';

interface IncomingAccept {
  bookingId: string;
  visitId: string;
  nurse: { id: string; firstName: string; lastName: string };
}

export default function BookVisitPage() {
  const router = useRouter();
  const { user, token } = useAuth();
  const toast = useToast();

  const [step, setStep] = useState<Step>('form');
  const [service, setService] = useState('general');
  const [duration, setDuration] = useState(60);
  const [address, setAddress] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CARD' | 'INSURANCE'>('CARD');
  const [insuranceProvider, setInsuranceProvider] = useState('');
  const [insuranceMemberNumber, setInsuranceMemberNumber] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<IncomingAccept | null>(null);
  const [searchSeconds, setSearchSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { send, lastMessage, connected } = useVisitWebSocket(token);

  // Minimum date: now + 30 min
  const minDate = new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 16);

  // Listen for BOOKING_ACCEPTED from WebSocket
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'BOOKING_ACCEPTED' && lastMessage.data) {
      const d = lastMessage.data as unknown as IncomingAccept;
      if (!bookingId || d.bookingId === bookingId) {
        setAccepted(d);
        setStep('found');
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }
  }, [lastMessage, bookingId]);

  // Search timer
  useEffect(() => {
    if (step === 'searching') {
      timerRef.current = setInterval(() => setSearchSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step]);

  // Navigate to tracker after "found" animation
  useEffect(() => {
    if (step === 'found' && accepted?.visitId) {
      const t = setTimeout(() => {
        router.push(`/patient/visit-tracker/${accepted.visitId}`);
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [step, accepted, router]);

  const getLocation = () => {
    setLocError('');
    if (!navigator.geolocation) {
      setLocError('Geolocation not supported by your browser.');
      return;
    }
    setStep('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStep('form');
      },
      () => {
        setLocError('Location access denied. Please allow location to book a visit.');
        setStep('form');
      },
      { timeout: 10000 }
    );
  };

  const selectedDuration = DURATIONS.find((d) => d.value === duration)!;
  const priceRands = (selectedDuration.price / 100).toFixed(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coords) { toast.error('Please share your location first.'); return; }
    if (!address.trim()) { toast.error('Please enter your address.'); return; }
    if (!scheduledDate) { toast.error('Please select a date and time.'); return; }
    if (paymentMethod === 'INSURANCE' && (!insuranceProvider.trim() || !insuranceMemberNumber.trim())) {
      toast.error('Please fill in your insurance details.'); return;
    }

    setSubmitting(true);
    try {
      const result = await bookingsApi.create({
        encryptedAddress: address.trim(),
        scheduledDate: new Date(scheduledDate).toISOString(),
        estimatedDuration: duration,
        paymentMethod,
        amountInCents: selectedDuration.price,
        patientLat: coords.lat,
        patientLng: coords.lng,
        ...(paymentMethod === 'INSURANCE' ? { insuranceProvider, insuranceMemberNumber } : {}),
      });
      setBookingId(result.booking?.id ?? null);
      setStep('searching');
      if (result.notifiedNurses === 0) {
        toast.info('No nurses online nearby right now. We\'ll keep looking — stay on this page.');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(e.response?.data?.error || e.message || 'Failed to submit booking.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── STEP: locating ──
  if (step === 'locating') {
    return (
      <RoleGuard allowedRoles={[UserRole.PATIENT]}>
        <DashboardLayout>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--background)', gap: 20 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg,#0d9488,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📍</div>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)' }}>Getting your location…</p>
          </div>
        </DashboardLayout>
      </RoleGuard>
    );
  }

  // ── STEP: searching ──
  if (step === 'searching') {
    return (
      <RoleGuard allowedRoles={[UserRole.PATIENT]}>
        <DashboardLayout>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--background)', gap: 24, padding: 32 }}>
            {/* Animated pulse rings */}
            <div style={{ position: 'relative', width: 140, height: 140 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #0d9488', opacity: 0, animation: `ping 2s ease-out ${i * 0.6}s infinite` }} />
              ))}
              <div style={{ position: 'absolute', inset: 16, borderRadius: '50%', background: 'linear-gradient(135deg,#0d9488,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>👩‍⚕️</div>
            </div>
            <style>{`@keyframes ping { 0%{transform:scale(0.5);opacity:0.8} 100%{transform:scale(2.5);opacity:0} }`}</style>

            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 22, fontWeight: 900, color: 'var(--foreground)', marginBottom: 8 }}>Finding your nurse…</p>
              <p style={{ fontSize: 14, color: 'var(--muted)' }}>Looking within 10 km · {searchSeconds}s elapsed</p>
              {!connected && <p style={{ fontSize: 12, color: '#d97706', marginTop: 8 }}>⚠️ Reconnecting to live updates…</p>}
            </div>

            <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 28px', width: '100%', maxWidth: 360, boxShadow: 'var(--shadow)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Service</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{SERVICES.find((s) => s.id === service)?.label}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Duration</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{duration} min</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Rate</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>R{priceRands}</span>
              </div>
            </div>

            <button
              onClick={() => { setStep('form'); setBookingId(null); }}
              style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Cancel search
            </button>
          </div>
        </DashboardLayout>
      </RoleGuard>
    );
  }

  // ── STEP: found ──
  if (step === 'found' && accepted) {
    return (
      <RoleGuard allowedRoles={[UserRole.PATIENT]}>
        <DashboardLayout>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--background)', gap: 24, padding: 32 }}>
            <div style={{ width: 100, height: 100, borderRadius: '50%', background: 'linear-gradient(135deg,#059669,#047857)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, boxShadow: '0 0 0 16px rgba(5,150,105,0.12)' }}>✅</div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 26, fontWeight: 900, color: 'var(--foreground)', marginBottom: 6 }}>Nurse Confirmed!</p>
              <p style={{ fontSize: 16, color: 'var(--muted)' }}>
                <strong style={{ color: '#059669' }}>
                  {accepted.nurse.firstName} {accepted.nurse.lastName}
                </strong>{' '}
                has accepted your visit request.
              </p>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>Opening live tracker…</p>
            </div>
          </div>
        </DashboardLayout>
      </RoleGuard>
    );
  }

  // ── STEP: form ──
  return (
    <RoleGuard allowedRoles={[UserRole.PATIENT]}>
      <DashboardLayout>
        <div style={{ background: 'var(--background)', minHeight: '100vh' }}>

          {/* Hero */}
          <div style={{ background: 'linear-gradient(135deg,#0a1628 0%,#0d2f5e 55%,#0a3d3a 100%)', padding: '28px 40px 24px' }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              <p style={{ color: 'rgba(94,234,212,0.8)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>On-Demand Care</p>
              <h1 style={{ color: 'white', fontSize: 'clamp(20px,3vw,28px)', fontWeight: 900, margin: 0 }}>Book a Nurse Visit 🏠</h1>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4 }}>A verified SANC-registered nurse will come to you, usually within 30 minutes.</p>
            </div>
          </div>

          <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

              {/* Service type */}
              <section>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)', marginBottom: 12 }}>What do you need?</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
                  {SERVICES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setService(s.id)}
                      style={{ background: service === s.id ? 'var(--primary-soft)' : 'white', border: `2px solid ${service === s.id ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 14, padding: '14px 12px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s' }}
                    >
                      <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>{s.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.desc}</div>
                    </button>
                  ))}
                </div>
              </section>

              {/* Duration */}
              <section>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)', marginBottom: 12 }}>How long?</h2>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {DURATIONS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setDuration(d.value)}
                      style={{ flex: '1 1 auto', minWidth: 90, background: duration === d.value ? 'var(--primary)' : 'white', border: `2px solid ${duration === d.value ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 12, padding: '12px 8px', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s' }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 800, color: duration === d.value ? 'white' : 'var(--foreground)' }}>{d.label}</div>
                      <div style={{ fontSize: 12, color: duration === d.value ? 'rgba(255,255,255,0.7)' : '#059669', fontWeight: 600, marginTop: 3 }}>R{(d.price / 100).toFixed(0)}</div>
                    </button>
                  ))}
                </div>
              </section>

              {/* Date/time + Address */}
              <section>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)', marginBottom: 12 }}>When &amp; where?</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Date &amp; Time</label>
                    <input
                      type="datetime-local"
                      min={minDate}
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      required
                      style={{ width: '100%', padding: '11px 14px', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, color: 'var(--foreground)', background: 'white', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Your Address</label>
                    <input
                      type="text"
                      placeholder="e.g. 12 Sandton Drive, Sandton, 2196"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      required
                      style={{ width: '100%', padding: '11px 14px', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, color: 'var(--foreground)', background: 'white', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>

                  {/* Location pin */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      type="button"
                      onClick={getLocation}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 10, border: `1.5px solid ${coords ? '#059669' : 'var(--border)'}`, background: coords ? 'rgba(5,150,105,0.07)' : 'white', fontSize: 13, fontWeight: 600, color: coords ? '#059669' : 'var(--muted)', cursor: 'pointer' }}
                    >
                      📍 {coords ? `Located (${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)})` : 'Share my location'}
                    </button>
                    {locError && <span style={{ fontSize: 12, color: '#dc2626' }}>{locError}</span>}
                  </div>
                </div>
              </section>

              {/* Payment */}
              <section>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)', marginBottom: 12 }}>Payment</h2>
                <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                  {(['CARD', 'INSURANCE'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      style={{ flex: 1, padding: '12px', borderRadius: 12, border: `2px solid ${paymentMethod === m ? 'var(--primary)' : 'var(--border)'}`, background: paymentMethod === m ? 'var(--primary-soft)' : 'white', fontSize: 13, fontWeight: 700, color: paymentMethod === m ? 'var(--primary)' : 'var(--muted)', cursor: 'pointer' }}
                    >
                      {m === 'CARD' ? '💳 Self-pay' : '🏥 Medical Aid'}
                    </button>
                  ))}
                </div>
                {paymentMethod === 'INSURANCE' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input
                      type="text"
                      placeholder="Medical aid provider (e.g. Discovery)"
                      value={insuranceProvider}
                      onChange={(e) => setInsuranceProvider(e.target.value)}
                      style={{ padding: '11px 14px', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, color: 'var(--foreground)', outline: 'none' }}
                    />
                    <input
                      type="text"
                      placeholder="Member number"
                      value={insuranceMemberNumber}
                      onChange={(e) => setInsuranceMemberNumber(e.target.value)}
                      style={{ padding: '11px 14px', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14, color: 'var(--foreground)', outline: 'none' }}
                    />
                  </div>
                )}
              </section>

              {/* Summary + Submit */}
              <div style={{ background: 'linear-gradient(135deg,#0a1628,#0d2f5e)', borderRadius: 18, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Total</p>
                  <p style={{ color: 'white', fontSize: 28, fontWeight: 900, margin: 0 }}>R{priceRands}</p>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 }}>{duration} min · {SERVICES.find((s) => s.id === service)?.label}</p>
                </div>
                <button
                  type="submit"
                  disabled={submitting || !coords}
                  style={{ padding: '14px 32px', borderRadius: 14, background: coords ? 'linear-gradient(135deg,#0d9488,#059669)' : 'rgba(255,255,255,0.15)', border: 'none', color: 'white', fontSize: 16, fontWeight: 800, cursor: coords && !submitting ? 'pointer' : 'not-allowed', opacity: submitting ? 0.7 : 1, fontFamily: 'inherit', boxShadow: coords ? '0 4px 20px rgba(13,148,136,0.4)' : 'none', transition: 'all 0.2s' }}
                >
                  {submitting ? 'Booking…' : !coords ? '📍 Location required' : 'Find a Nurse →'}
                </button>
              </div>

            </form>
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
