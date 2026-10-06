import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "inherit" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ marginBottom: 40 }}>
          <Link href="/" style={{ color: "#0d9488", fontWeight: 600, fontSize: 14, textDecoration: "none" }}>← Back to Ahava Healthcare</Link>
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>Privacy Policy</h1>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 40 }}>Last updated: October 2026</p>

        <div style={{ background: "white", borderRadius: 16, padding: "32px 36px", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", lineHeight: 1.8, color: "#334155" }}>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 0 }}>1. Who We Are</h2>
          <p>Ahava Healthcare (Pty) Ltd (&ldquo;Ahava&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) operates a digital health platform connecting patients with nurses and doctors in South Africa. Our registered address is in South Africa.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>2. Information We Collect</h2>
          <p>We collect the following categories of personal information:</p>
          <ul>
            <li><strong>Account information:</strong> Name, email address, phone number, date of birth, gender.</li>
            <li><strong>Sign-in details (only if you choose Sign in with Google):</strong> your Google account name, email address and a unique Google account ID. See section 6.</li>
            <li><strong>Health data:</strong> Biometric readings (heart rate, blood pressure, oxygen saturation, temperature), wearable device data synced through Terra, ROOK or Android Health Connect when you connect a device, the symptoms and photos you submit for AI triage, and the results.</li>
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
            <li><strong>Service providers</strong> who process data on our behalf to run the platform, listed in section 7.</li>
            <li><strong>Legal authorities:</strong> When required by South African law.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>6. Sign in with Google</h2>
          <p>Patients can choose to sign in or sign up with their Google account. Doctors, nurses and administrators cannot; their accounts use an email address, password and two-factor authentication.</p>
          <ul>
            <li><strong>What we receive from Google:</strong> your name, your email address (and whether Google has verified it) and a unique Google account ID. We ask only for the basic sign-in permissions (<em>openid</em>, <em>email</em> and <em>profile</em>). We do not access your contacts, calendar, Drive, Gmail, Google Fit or any Google health data.</li>
            <li><strong>What we do with it:</strong> create your Ahava account or sign you in, recognise your Google account the next time you sign in, and, if an Ahava account with that email already exists, link the two only after you confirm that account&rsquo;s password.</li>
            <li><strong>What we store:</strong> your Google account ID, the email address Google gave us and the date you last signed in with Google. We do not store your Google password or profile photo.</li>
            <li><strong>What we do not do:</strong> we do not use Google user data for advertising, we do not sell it or share it with data brokers, and we do not use it to train AI models.</li>
            <li><strong>Google API Services User Data Policy:</strong> Ahava&rsquo;s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" style={{ color: "#0d9488" }}>Google API Services User Data Policy</a>, including the Limited Use requirements.</li>
            <li><strong>Disconnecting:</strong> you can unlink Google in your Ahava profile (you need a password set first), or remove Ahava&rsquo;s access in your Google Account under <em>Security &rarr; Third-party access</em>. Deleting your Ahava account removes the stored Google details.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>7. Service Providers and Transfers Outside South Africa</h2>
          <p>We use the following providers to run the platform. Each receives only what it needs for its job:</p>
          <ul>
            <li><strong>AI triage (Anthropic and Google Gemini):</strong> when you use AI triage, one or both of these AI services receive the symptoms you describe, any photo you attach, and relevant readings and health-profile details. They are labelled with an internal case reference, not your name, phone number or email address. AI output is advice for a clinician to review, not a diagnosis.</li>
            <li><strong>Email (Resend):</strong> delivers verification, password-reset and service emails to your email address.</li>
            <li><strong>Payments (PayFast):</strong> processes your payment. You enter card details on PayFast&rsquo;s pages; we do not receive or store your card number.</li>
            <li><strong>Medical-aid claims (Healthbridge):</strong> where medical-aid billing is used, claim details such as visit date, tariff codes and member details are sent to your scheme through the Healthbridge clearing house.</li>
            <li><strong>Wearables (Terra, ROOK, Android Health Connect):</strong> only when you connect a device. Each is governed by its own privacy policy.</li>
            <li><strong>Hosting and storage (Railway, Cloudflare R2):</strong> hold the platform and uploaded files. <strong>Key management (Amazon Web Services KMS):</strong> protects our encryption keys; it does not receive patient records.</li>
            <li><strong>Public medical references (such as NCBI/PubMed and StatPearls):</strong> receive general clinical search terms, never your identity.</li>
          </ul>
          <p>Some of these providers process information on servers outside South Africa. When we send personal information to another country we do so only where section 72 of POPIA allows it: the recipient is bound by law, a binding agreement or binding corporate rules that give substantially similar protection, or you have consented, or the transfer is needed to provide the service you asked for. You can ask us which providers hold your information by contacting our Information Officer.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>8. Data Retention</h2>
          <p>We retain your personal information for as long as your account is active or as required by law. Health records are retained for a minimum of 5 years as required by the National Health Act. You may request deletion of non-mandatory data by contacting us.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>9. Your Rights Under POPIA</h2>
          <p>You have the right to:</p>
          <ul>
            <li>Access your personal information held by us.</li>
            <li>Request correction of inaccurate information.</li>
            <li>Request deletion of personal information (subject to legal retention requirements).</li>
            <li>Object to the processing of your personal information.</li>
            <li>Lodge a complaint with the Information Regulator of South Africa.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>10. Security</h2>
          <p>We implement industry-standard security measures including encryption of sensitive fields at rest, TLS in transit, secure session cookies, mandatory two-factor authentication for doctors, nurses and administrators, limits on repeated sign-in attempts, and an audit trail of who accesses patient records. No system is perfectly secure; we will notify you promptly in the event of a breach affecting your data.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>11. Cookies</h2>
          <p>We use essential cookies for authentication sessions and to secure the sign-in process. We do not use tracking or advertising cookies. If you use Sign in with Google, Google may set its own cookies on its sign-in button; those are governed by Google&rsquo;s privacy policy.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>12. Contact Us</h2>
          <p>For privacy-related queries or to exercise your POPIA rights, contact our Information Officer at: <strong>privacy@ahavaon88.co.za</strong></p>

        </div>
      </div>
    </div>
  );
}
