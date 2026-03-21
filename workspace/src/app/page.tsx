import Link from 'next/link';

export default function Home() {
  const features = [
    { icon: '🧠', title: 'AI Health Monitoring', desc: 'Real-time biometric tracking with intelligent baseline analysis and early-warning alerts before things get serious.', accent: '#0d9488' },
    { icon: '🏥', title: 'On-Demand Nursing', desc: 'Connect with SANC-verified nurses in your area within minutes for professional home visits and care.', accent: '#059669' },
    { icon: '🔒', title: 'POPIA Compliant', desc: 'Your medical data is encrypted end-to-end and stored securely in full compliance with South African law.', accent: '#7c3aed' },
    { icon: '⚕️', title: 'Doctor Oversight', desc: 'Every AI diagnostic report is reviewed and validated by a licensed HPCSA-registered doctor before release.', accent: '#b45309' },
  ];

  const stats = [
    { icon: '❤️', value: 'Patient-Centric', label: 'Care at every step' },
    { icon: '✅', value: 'Verified Nurses', label: 'SANC registered' },
    { icon: '⚕️', value: 'Verified Doctors', label: 'HPCSA registered' },
    { icon: '⚡', value: '< 8 min', label: 'Avg Response Time' },
  ];

  const steps = [
    { num: '01', icon: '📝', title: 'Create Your Profile', desc: 'Sign up in under 2 minutes. Tell us your role — patient, nurse, or doctor — and we tailor your experience.' },
    { num: '02', icon: '📡', title: 'Connect & Monitor', desc: 'Link your wearable or manually log vitals. Our AI builds your personal health baseline immediately.' },
    { num: '03', icon: '✅', title: 'Get Care Instantly', desc: 'Request a nurse visit or symptom analysis. A verified professional responds in minutes, reviewed by a doctor.' },
  ];

  return (
    <div style={{ fontFamily: 'var(--font-jakarta, system-ui, sans-serif)', background: '#f5f3ef', color: '#1c1917' }}>
      <style>{`
        @keyframes orbit-cw  { to { transform: rotate(360deg);  } }
        @keyframes orbit-ccw { to { transform: rotate(-360deg); } }
        @keyframes pill-ccw  { from { transform: translate(-50%,-50%) rotate(0deg);    } to { transform: translate(-50%,-50%) rotate(-360deg); } }
        @keyframes pill-cw   { from { transform: translate(-50%,-50%) rotate(0deg);    } to { transform: translate(-50%,-50%) rotate(360deg);  } }
        @keyframes scan-down { 0%{top:0;opacity:0} 4%{opacity:1} 96%{opacity:1} 100%{top:100%;opacity:0} }
        @keyframes dot-blink { 0%,100%{opacity:1} 50%{opacity:.12} }
      `}</style>

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

          {/* Right: animated orbit system */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: 300, height: 300, flexShrink: 0 }}>

              {/* Scan line */}
              <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,rgba(13,148,136,0.08),rgba(13,148,136,0.32),rgba(13,148,136,0.08),transparent)', animation: 'scan-down 7s linear infinite', zIndex: 1, pointerEvents: 'none' }} />

              {/* Dashed orbit rings */}
              <div style={{ position: 'absolute', width: 164, height: 164, borderRadius: '50%', border: '1px dashed rgba(13,148,136,0.28)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
              <div style={{ position: 'absolute', width: 256, height: 256, borderRadius: '50%', border: '1px dashed rgba(13,148,136,0.13)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />

              {/* Hub */}
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 72, height: 72, borderRadius: '50%', background: 'rgba(7,26,34,0.96)', border: '1.5px solid rgba(13,148,136,0.45)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                <span style={{ fontSize: 24 }}>⚕️</span>
                <span style={{ color: 'rgba(0,220,150,0.75)', fontSize: 7, fontWeight: 700, letterSpacing: '0.1em', marginTop: 2 }}>LIVE</span>
              </div>

              {/* Inner orbit — clockwise 22 s */}
              <div style={{ position: 'absolute', width: '100%', height: '100%', top: 0, left: 0, animation: 'orbit-cw 22s linear infinite', transformOrigin: 'center' }}>
                {[
                  { t: 'Heart Rate', v: '72', u: 'bpm',  b: 'Normal',      c: '#f87171', a: 0   },
                  { t: 'SpO₂',      v: '98', u: '%',    b: 'Optimal',     c: '#60a5fa', a: 90  },
                  { t: 'Nurse ETA', v: '7',  u: 'min',  b: 'En route',    c: '#fbbf24', a: 180 },
                  { t: 'AI Ready',  v: '✓',  u: 'Done', b: 'Dr. Khumalo', c: '#34d399', a: 270 },
                ].map(({ t, v, u, b, c, a }) => {
                  const rad = a * Math.PI / 180;
                  return (
                    <div key={t} style={{ position: 'absolute', left: 150 + Math.cos(rad) * 82, top: 150 + Math.sin(rad) * 82, animation: 'pill-ccw 22s linear infinite', animationFillMode: 'both', background: 'rgba(5,20,28,0.93)', border: '1px solid rgba(13,148,136,0.22)', borderRadius: 10, padding: '7px 10px', minWidth: 82, whiteSpace: 'nowrap', zIndex: 6 }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(0,220,150,0.72)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{t}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: c, lineHeight: 1.1 }}>{v} <span style={{ fontSize: 9, color: 'rgba(150,200,185,0.45)' }}>{u}</span></div>
                      <div style={{ fontSize: 8, padding: '2px 6px', borderRadius: 20, marginTop: 3, background: `${c}18`, color: c, border: `0.5px solid ${c}55`, display: 'inline-block' }}>{b}</div>
                    </div>
                  );
                })}
              </div>

              {/* Outer orbit — counter-clockwise 32 s */}
              <div style={{ position: 'absolute', width: '100%', height: '100%', top: 0, left: 0, animation: 'orbit-ccw 32s linear infinite', transformOrigin: 'center' }}>
                {[
                  { t: 'Monitoring', v: '24/7', u: 'always on',  b: 'Live',     c: '#34d399', a: 45  },
                  { t: 'Results',    v: '3s',   u: 'turnaround', b: 'Quick',    c: '#60a5fa', a: 165 },
                  { t: 'Rated',      v: '4.9★', u: 'stars',      b: 'Top care', c: '#fbbf24', a: 285 },
                ].map(({ t, v, u, b, c, a }) => {
                  const rad = a * Math.PI / 180;
                  return (
                    <div key={t} style={{ position: 'absolute', left: 150 + Math.cos(rad) * 128, top: 150 + Math.sin(rad) * 128, animation: 'pill-cw 32s linear infinite', animationFillMode: 'both', background: 'rgba(5,20,28,0.93)', border: '1px solid rgba(13,148,136,0.15)', borderRadius: 10, padding: '7px 10px', minWidth: 78, whiteSpace: 'nowrap', zIndex: 6 }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(0,220,150,0.65)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{t}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: c, lineHeight: 1.1 }}>{v} <span style={{ fontSize: 9, color: 'rgba(150,200,185,0.45)' }}>{u}</span></div>
                      <div style={{ fontSize: 8, padding: '2px 6px', borderRadius: 20, marginTop: 3, background: `${c}14`, color: c, border: `0.5px solid ${c}44`, display: 'inline-block' }}>{b}</div>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section style={{ background: 'linear-gradient(135deg,#0d9488,#059669)', padding: '32px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 24, textAlign: 'center' }}>
          {stats.map(({ icon, value, label }) => (
            <div key={value} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'white', lineHeight: 1.2 }}>{value}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 3, fontWeight: 500 }}>{label}</div>
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
