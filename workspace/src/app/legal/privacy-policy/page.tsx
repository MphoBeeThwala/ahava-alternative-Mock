import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "inherit" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ marginBottom: 40 }}>
          <Link href="/" style={{ color: "#0d9488", fontWeight: 600, fontSize: 14, textDecoration: "none" }}>← Back to Ahava Healthcare</Link>
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>Privacy Policy</h1>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 40 }}>Last updated: March 2026</p>

        <div style={{ background: "white", borderRadius: 16, padding: "32px 36px", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", lineHeight: 1.8, color: "#334155" }}>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 0 }}>1. Who We Are</h2>
          <p>Ahava Healthcare (Pty) Ltd (&ldquo;Ahava&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) operates a digital health platform connecting patients with nurses and doctors in South Africa. Our registered address is in South Africa.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>2. Information We Collect</h2>
          <p>We collect the following categories of personal information:</p>
          <ul>
            <li><strong>Account information:</strong> Name, email address, phone number, date of birth, gender.</li>
            <li><strong>Health data:</strong> Biometric readings (heart rate, blood pressure, oxygen saturation, temperature), wearable device data synced via Terra API, AI triage responses.</li>
            <li><strong>Location data:</strong> Approximate location used to match you with nearby nurses (nurses only, collected during active availability).</li>
            <li><strong>Device data:</strong> IP address, browser/app type, usage logs for security and debugging.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>3. Why We Process Your Data (POPIA Lawful Basis)</h2>
          <p>Under the Protection of Personal Information Act (POPIA), we process your personal information on the following bases:</p>
          <ul>
            <li><strong>Performance of a contract:</strong> To provide you with healthcare coordination services.</li>
            <li><strong>Legitimate interest:</strong> To improve platform safety, detect fraud, and send service notifications.</li>
            <li><strong>Consent:</strong> For health data processing and wearable device integration. You may withdraw consent at any time.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>4. How We Use Your Data</h2>
          <ul>
            <li>Providing and improving our healthcare coordination services.</li>
            <li>Generating AI-assisted health insights and early-warning alerts.</li>
            <li>Facilitating nurse and doctor visits.</li>
            <li>Sending you appointment reminders, health alerts, and service updates.</li>
            <li>Complying with legal and regulatory obligations.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>5. Data Sharing</h2>
          <p>We do not sell your personal information. We share data only with:</p>
          <ul>
            <li><strong>Healthcare professionals:</strong> Nurses and doctors on our platform who are treating you.</li>
            <li><strong>Terra API:</strong> Our wearable integration partner, governed by their own privacy policy, used only when you explicitly connect a device.</li>
            <li><strong>Infrastructure providers:</strong> Railway (hosting), Cloudflare R2 (file storage) — both under data processing agreements.</li>
            <li><strong>Legal authorities:</strong> When required by South African law.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>6. Data Retention</h2>
          <p>We retain your personal information for as long as your account is active or as required by law. Health records are retained for a minimum of 5 years as required by the National Health Act. You may request deletion of non-mandatory data by contacting us.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>7. Your Rights Under POPIA</h2>
          <p>You have the right to:</p>
          <ul>
            <li>Access your personal information held by us.</li>
            <li>Request correction of inaccurate information.</li>
            <li>Request deletion of personal information (subject to legal retention requirements).</li>
            <li>Object to the processing of your personal information.</li>
            <li>Lodge a complaint with the Information Regulator of South Africa.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>8. Security</h2>
          <p>We implement industry-standard security measures including encryption of sensitive fields at rest, TLS in transit, JWT-based authentication, and rate limiting. No system is perfectly secure; we will notify you promptly in the event of a breach affecting your data.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>9. Cookies</h2>
          <p>We use essential cookies for authentication sessions. We do not use tracking or advertising cookies.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>10. Contact Us</h2>
          <p>For privacy-related queries or to exercise your POPIA rights, contact our Information Officer at: <strong>privacy@ahavahealthcare.co.za</strong></p>

        </div>
      </div>
    </div>
  );
}
