import Link from 'next/link';

export default function Home() {
  const features = [
    { icon: '🧠', title: 'AI Health Monitoring', desc: 'Real-time biometric tracking with intelligent baseline analysis and early-warning alerts before things get serious.', accent: '#0d9488' },
    { icon: '🏥', title: 'On-Demand Nursing', desc: 'Connect with SANC-verified nurses in your area within minutes for professional home visits and care.', accent: '#059669' },
    { icon: '🔒', title: 'POPIA Compliant', desc: 'Your medical data is encrypted end-to-end and stored securely in full compliance with South African law.', accent: '#7c3aed' },
    { icon: '⚕️', title: 'Doctor Oversight', desc: 'Every AI diagnostic report is reviewed and validated by a licensed HPCSA-registered doctor before release.', accent: '#b45309' },
  ];

  const stats = [
    { value: '2 500+', label: 'Patients Served' },
    { value: '350+', label: 'Verified Nurses' },
    { value: '80+', label: 'Licensed Doctors' },
    { value: '< 8 min', label: 'Avg Response Time' },
  ];

  const steps = [
    { num: '01', icon: '📝', title: 'Create Your Profile', desc: 'Sign up in under 2 minutes. Tell us your role — patient, nurse, or doctor — and we tailor your experience.' },
    { num: '02', icon: '📡', title: 'Connect & Monitor', desc: 'Link your wearable or manually log vitals. Our AI builds your personal health baseline immediately.' },
    { num: '03', icon: '✅', title: 'Get Care Instantly', desc: 'Request a nurse visit or symptom analysis. A verified professional responds in minutes, reviewed by a doctor.' },
  ];

  return (
    <div style={{ fontFamily: 'var(--font-jakarta, system-ui, sans-serif)', background: '#f5f3ef', color: '#1c1917' }}>

      {/* ── NAV ── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(10,22,40,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#0d9488,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⚕️</div>
            <span style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>Ahava Healthcare</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href="/auth/login" style={{ background: 'transparent', border: '1.5px solid rgba(255,255,255,0.25)', color: 'white', borderRadius: 8, padding: '8px 20px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              Log In
            </Link>
            <Link href="/auth/signup" style={{ background: 'linear-gradient(135deg,#0d9488,#059669)', border: 'none', color: 'white', borderRadius: 8, padding: '8px 20px', fontSize: 14, fontWeight: 700, textDecoration: 'none', boxShadow: '0 4px 14px rgba(13,148,136,0.4)' }}>
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ position: 'relative', background: 'linear-gradient(135deg,#0a1628 0%,#0d2f5e 50%,#0a3d3a 100%)', overflow: 'hidden', minHeight: '92vh', display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', top: -120, right: -120, width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle,rgba(13,148,136,0.18),transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -100, left: -80, width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle,rgba(0,74,173,0.2),transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center', width: '100%' }}>
          {/* Left */}
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(13,148,136,0.15)', border: '1px solid rgba(13,148,136,0.3)', borderRadius: 30, padding: '6px 16px', marginBottom: 28 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0d9488', display: 'inline-block' }} />
              <span style={{ color: '#5eead4', fontSize: 13, fontWeight: 600 }}>Now serving South Africa · HPCSA Registered</span>
            </div>

            <h1 style={{ fontSize: 'clamp(36px,4vw,58px)', fontWeight: 900, color: 'white', lineHeight: 1.1, marginBottom: 20 }}>
              Healthcare that{' '}
              <span style={{ background: 'linear-gradient(90deg,#0d9488,#34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                comes to you
              </span>
              <br />
              <span style={{ color: 'rgba(255,255,255,0.85)' }}>powered by AI</span>
            </h1>

            <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, marginBottom: 40, maxWidth: 480 }}>
              Instant symptom triage, real-time biometric monitoring, and on-demand nurse home visits — all in one platform built for South Africans.
            </p>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <Link href="/auth/signup" style={{ background: 'linear-gradient(135deg,#0d9488,#059669)', border: 'none', color: 'white', borderRadius: 10, padding: '14px 32px', fontSize: 16, fontWeight: 700, textDecoration: 'none', boxShadow: '0 8px 24px rgba(13,148,136,0.4)', display: 'inline-block' }}>
                Create Free Account →
              </Link>
              <Link href="/auth/login" style={{ background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: 10, padding: '14px 32px', fontSize: 16, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}>
                Sign In
              </Link>
            </div>

            <div style={{ marginTop: 32, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {[['🔒', 'POPIA Compliant'], ['✅', 'SANC Verified Nurses'], ['⚡', '8-min avg response']].map(([icon, label]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
                  <span>{icon}</span><span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: floating metric cards */}
          <div style={{ position: 'relative', height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 24, padding: '28px 36px', textAlign: 'center', zIndex: 2 }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>⚕️</div>
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16, fontWeight: 800 }}>Ahava Healthcare</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>Revolutionizing Healthcare SA</div>
            </div>
            <div style={{ position: 'absolute', top: 30, right: 20, background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '14px 18px', zIndex: 3 }}>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>❤️ Heart Rate</div>
              <div style={{ color: '#f87171', fontSize: 26, fontWeight: 900 }}>72 <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>bpm</span></div>
              <div style={{ color: '#4ade80', fontSize: 11, marginTop: 2 }}>● Normal range</div>
            </div>
            <div style={{ position: 'absolute', bottom: 50, right: 10, background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '14px 18px', zIndex: 3 }}>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>💧 SpO₂</div>
              <div style={{ color: '#60a5fa', fontSize: 26, fontWeight: 900 }}>98<span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>%</span></div>
              <div style={{ color: '#4ade80', fontSize: 11, marginTop: 2 }}>● Optimal</div>
            </div>
            <div style={{ position: 'absolute', top: 60, left: 10, background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '14px 18px', zIndex: 3 }}>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>🏥 Nurse En Route</div>
              <div style={{ color: '#34d399', fontSize: 22, fontWeight: 900 }}>7 min</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>Sister Nomsa · ⭐ 4.9</div>
            </div>
            <div style={{ position: 'absolute', bottom: 30, left: 20, background: 'rgba(13,148,136,0.15)', backdropFilter: 'blur(16px)', border: '1px solid rgba(13,148,136,0.3)', borderRadius: 14, padding: '10px 16px', zIndex: 3 }}>
              <div style={{ color: '#34d399', fontSize: 12, fontWeight: 700 }}>✅ AI Analysis Complete</div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 2 }}>Reviewed by Dr. Khumalo</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section style={{ background: 'linear-gradient(135deg,#0d9488,#059669)', padding: '32px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 24, textAlign: 'center' }}>
          {stats.map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontSize: 32, fontWeight: 900, color: 'white' }}>{value}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4, fontWeight: 500 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section style={{ background: 'white', padding: '96px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ display: 'inline-block', background: 'rgba(13,148,136,0.1)', color: '#0d9488', borderRadius: 30, padding: '6px 18px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>Platform Features</div>
            <h2 style={{ fontSize: 'clamp(28px,3vw,42px)', fontWeight: 900, color: '#1c1917', marginBottom: 14 }}>Everything your health needs</h2>
            <p style={{ fontSize: 17, color: '#57534e', maxWidth: 520, margin: '0 auto' }}>One platform built for patients, nurses, and doctors — seamlessly connected.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 28 }}>
            {features.map(({ icon, title, desc, accent }) => (
              <div key={title} style={{ background: 'white', border: '1.5px solid #e7e5e4', borderRadius: 20, padding: '32px 28px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', transition: 'all 0.2s' }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: `${accent}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 20 }}>
                  {icon}
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1c1917', marginBottom: 10 }}>{title}</h3>
                <p style={{ fontSize: 14, color: '#57534e', lineHeight: 1.65 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ background: '#f5f3ef', padding: '96px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ display: 'inline-block', background: 'rgba(5,150,105,0.1)', color: '#059669', borderRadius: 30, padding: '6px 18px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>How It Works</div>
            <h2 style={{ fontSize: 'clamp(28px,3vw,42px)', fontWeight: 900, color: '#1c1917', marginBottom: 14 }}>Up and running in minutes</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 32 }}>
            {steps.map(({ num, icon, title, desc }) => (
              <div key={num} style={{ position: 'relative' }}>
                <div style={{ background: 'white', border: '1.5px solid #e7e5e4', borderRadius: 20, padding: '36px 28px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
                  <div style={{ position: 'absolute', top: -16, left: 28, background: 'linear-gradient(135deg,#0d9488,#059669)', color: 'white', borderRadius: 10, padding: '4px 14px', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em' }}>STEP {num}</div>
                  <div style={{ fontSize: 36, marginBottom: 18 }}>{icon}</div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1c1917', marginBottom: 10 }}>{title}</h3>
                  <p style={{ fontSize: 14, color: '#57534e', lineHeight: 1.65 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ background: 'linear-gradient(135deg,#0a1628,#0d2f5e,#0a3d3a)', padding: '80px 24px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -80, right: -80, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle,rgba(13,148,136,0.15),transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <h2 style={{ fontSize: 'clamp(28px,3.5vw,46px)', fontWeight: 900, color: 'white', marginBottom: 16 }}>Your health journey starts today</h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', marginBottom: 40, lineHeight: 1.7 }}>
            Join thousands of South Africans who&apos;ve taken control of their health with Ahava.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/auth/signup" style={{ background: 'linear-gradient(135deg,#0d9488,#059669)', border: 'none', color: 'white', borderRadius: 10, padding: '15px 36px', fontSize: 16, fontWeight: 700, textDecoration: 'none', boxShadow: '0 8px 24px rgba(13,148,136,0.4)', display: 'inline-block' }}>
              Get Started Free →
            </Link>
            <Link href="/auth/login" style={{ background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: 10, padding: '15px 36px', fontSize: 16, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}>
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: '#0a1628', padding: '40px 24px 32px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#0d9488,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⚕️</div>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600, fontSize: 14 }}>Ahava Healthcare</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
            © {new Date().getFullYear()} Ahava Healthcare · POPIA Compliant · HPCSA Registered
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            {[['🔒', 'Privacy'], ['📋', 'Terms'], ['📞', 'Contact']].map(([icon, label]) => (
              <span key={label} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer' }}>{icon} {label}</span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
