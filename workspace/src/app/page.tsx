import Link from 'next/link';
import { BRAND, Logo } from '../components/Logo';
import { Icon, type IconName } from '../components/ui/Icon';

const INK = '#1F2A26';
const MUTED = '#5E665F';
const LINE = '#E6DFD2';
const serif = 'var(--font-serif, Georgia, serif)';

const steps = [
  { n: '1', title: 'Tell us what’s going on', desc: 'Describe your symptoms in your own words, and add a photo if it helps.' },
  { n: '2', title: 'Get a clear next step', desc: 'AI checks your symptoms and suggests how urgent they are and what to do. A clinician reviews the result.' },
  { n: '3', title: 'Follow it up', desc: 'Book a nurse visit, or keep an eye on your vitals from your phone so changes get noticed early.' },
];

const features: { icon: IconName; title: string; desc: string }[] = [
  { icon: 'stethoscope', title: 'Symptom Check', desc: 'Plain-language guidance on how urgent your symptoms are, with a clinician reviewing the result.' },
  { icon: 'watch', title: 'Vitals from your phone', desc: 'Connect Health Connect or Apple Health. Ahava learns your normal and flags meaningful changes.' },
  { icon: 'calendar', title: 'Nurse visits', desc: 'Book a nurse to come to you when you need hands-on care.' },
];

const safety = [
  'A clinician reviews AI triage results.',
  'Sensitive records are encrypted in our database.',
  'You can see who has opened your record.',
  'Nurses, doctors and admins sign in with two-factor authentication.',
];

const primaryBtn: React.CSSProperties = {
  background: BRAND.green, color: BRAND.cream, borderRadius: 999, padding: '14px 28px',
  fontSize: 16, fontWeight: 600, textDecoration: 'none', display: 'inline-block',
};
const ghostBtn: React.CSSProperties = {
  color: BRAND.deep, border: `1.5px solid ${BRAND.green}`, borderRadius: 999, padding: '13px 26px',
  fontSize: 16, fontWeight: 600, textDecoration: 'none', display: 'inline-block',
};

export default function Home() {
  return (
    <div style={{ fontFamily: 'var(--font-jakarta, system-ui, sans-serif)', background: BRAND.cream, color: INK }}>
      {/* NAV */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(251,247,240,0.92)', backdropFilter: 'blur(10px)', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 24px', height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/" aria-label="Ahava Healthcare home" style={{ textDecoration: 'none' }}>
            <Logo size={32} />
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <a href="#how" className="hidden sm:inline" style={{ color: MUTED, fontSize: 15, textDecoration: 'none' }}>How it works</a>
            <a href="#safety" className="hidden sm:inline" style={{ color: MUTED, fontSize: 15, textDecoration: 'none' }}>Safety</a>
            <Link href="/auth/login" style={{ color: BRAND.deep, fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>
            <Link href="/auth/signup" style={{ ...primaryBtn, padding: '9px 20px', fontSize: 14 }}>Join the beta</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ padding: '72px 24px 88px' }}>
        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ maxWidth: 1120, margin: '0 auto', gap: 56, alignItems: 'center' }}>
          <div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#F6E3D8', color: '#8A3A1D', borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, marginBottom: 24 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: BRAND.coral }} />
              Closed beta · Invite only
            </span>
            <h1 style={{ fontFamily: serif, fontSize: 'clamp(38px,5vw,60px)', fontWeight: 600, lineHeight: 1.08, letterSpacing: '-0.02em', color: BRAND.deep, margin: '0 0 20px' }}>
              Know what to do about your symptoms, in minutes.
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.65, color: MUTED, maxWidth: 480, margin: '0 0 32px' }}>
              Ahava checks your symptoms with AI, a clinician reviews the result, and you get a clear next step. Built in South Africa.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href="/auth/signup" style={primaryBtn}>Join the beta</Link>
              <a href="#how" style={ghostBtn}>See how it works</a>
            </div>
            <p style={{ fontSize: 13, color: MUTED, marginTop: 20, maxWidth: 440, lineHeight: 1.6 }}>
              You&apos;ll need an invite code. Ahava is a test version and isn&apos;t for emergencies: in an emergency call 112 or 10177.
            </p>
          </div>

          {/* Product visual: one example screen */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 320, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 32, padding: 18, boxShadow: '0 24px 60px -24px rgba(11,59,49,0.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Icon name="stethoscope" size={18} />
                <span style={{ fontSize: 14, fontWeight: 700, color: BRAND.deep }}>Symptom Check</span>
              </div>
              <div style={{ background: '#F3F0E8', borderRadius: 14, padding: '10px 12px', fontSize: 13, color: INK, lineHeight: 1.5 }}>
                Sore throat and a fever for two days. Hard to swallow.
              </div>
              <div style={{ marginTop: 12, border: `1px solid ${LINE}`, borderRadius: 16, padding: 14 }}>
                <span style={{ display: 'inline-block', background: '#FBEBC8', color: '#7A4B05', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>
                  See a clinician within 24 hours
                </span>
                <p style={{ fontSize: 13, lineHeight: 1.55, color: INK, margin: '10px 0 8px' }}>
                  This looks like a throat infection. Rest, drink fluids, and book a visit if the fever passes 38.5°C.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: BRAND.green, fontWeight: 600 }}>
                  <Icon name="check-circle" size={15} />
                  Reviewed by a clinician
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#8A8478', textAlign: 'center', margin: '12px 0 0' }}>Example screen with demo data</p>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{ background: '#fff', borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, padding: '80px 24px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <h2 style={{ fontFamily: serif, fontSize: 'clamp(28px,3.4vw,40px)', fontWeight: 600, color: BRAND.deep, margin: '0 0 40px', letterSpacing: '-0.01em' }}>How it works</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 28 }}>
            {steps.map(({ n, title, desc }) => (
              <div key={n}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#F6E3D8', color: '#8A3A1D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: serif, fontSize: 20, fontWeight: 600, marginBottom: 14 }}>{n}</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: BRAND.deep, margin: '0 0 8px' }}>{title}</h3>
                <p style={{ fontSize: 15, lineHeight: 1.65, color: MUTED, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHAT YOU CAN DO */}
      <section style={{ padding: '80px 24px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <h2 style={{ fontFamily: serif, fontSize: 'clamp(28px,3.4vw,40px)', fontWeight: 600, color: BRAND.deep, margin: '0 0 40px', letterSpacing: '-0.01em' }}>What you can do</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 24 }}>
            {features.map(({ icon, title, desc }) => (
              <div key={title} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: 28 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: '#E3EFEA', color: BRAND.green, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <Icon name={icon} size={22} />
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: BRAND.deep, margin: '0 0 8px' }}>{title}</h3>
                <p style={{ fontSize: 15, lineHeight: 1.65, color: MUTED, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SAFETY */}
      <section id="safety" style={{ background: '#fff', borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, padding: '80px 24px' }}>
        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ maxWidth: 1120, margin: '0 auto', gap: 48, alignItems: 'start' }}>
          <div>
            <h2 style={{ fontFamily: serif, fontSize: 'clamp(28px,3.4vw,40px)', fontWeight: 600, color: BRAND.deep, margin: '0 0 14px', letterSpacing: '-0.01em' }}>Built to be safe</h2>
            <p style={{ fontSize: 16, lineHeight: 1.7, color: MUTED, margin: 0, maxWidth: 440 }}>
              Ahava supports decisions, it doesn&apos;t replace a doctor. It&apos;s in closed beta, so please use demo health data while we finish hardening it.
            </p>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14 }}>
            {safety.map((s) => (
              <li key={s} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 16, lineHeight: 1.55, color: INK }}>
                <span style={{ color: BRAND.green, marginTop: 2, flexShrink: 0 }}><Icon name="check-circle" size={20} /></span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: BRAND.deep, padding: '72px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <h2 style={{ fontFamily: serif, fontSize: 'clamp(28px,3.4vw,40px)', fontWeight: 600, color: BRAND.cream, margin: '0 0 14px', letterSpacing: '-0.01em' }}>Want to try Ahava?</h2>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: 'rgba(251,247,240,0.75)', margin: '0 0 28px' }}>
            It&apos;s invite-only while we test. If you have a code, join the beta.
          </p>
          <Link href="/auth/signup" style={{ ...primaryBtn, background: BRAND.coral, color: '#2A0F05' }}>Join the beta</Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: BRAND.deep, borderTop: '1px solid rgba(251,247,240,0.12)', padding: '32px 24px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <Logo size={26} tone="dark" />
          <div style={{ color: 'rgba(251,247,240,0.55)', fontSize: 13 }}>© {new Date().getFullYear()} Ahava Healthcare</div>
          <div style={{ display: 'flex', gap: 18 }}>
            {/* Real links: Google's OAuth review requires the home page to link to the privacy policy. */}
            <Link href="/legal/privacy-policy" style={{ color: 'rgba(251,247,240,0.75)', fontSize: 13, textDecoration: 'none' }}>Privacy policy</Link>
            <Link href="/legal/terms" style={{ color: 'rgba(251,247,240,0.75)', fontSize: 13, textDecoration: 'none' }}>Terms of service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
