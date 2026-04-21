import Link from "next/link";

export default function TermsOfServicePage() {
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "inherit" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ marginBottom: 40 }}>
          <Link href="/" style={{ color: "#0d9488", fontWeight: 600, fontSize: 14, textDecoration: "none" }}>← Back to Ahava Healthcare</Link>
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>Terms of Service</h1>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 40 }}>Last updated: March 2026</p>

        <div style={{ background: "white", borderRadius: 16, padding: "32px 36px", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", lineHeight: 1.8, color: "#334155" }}>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 0 }}>1. Acceptance of Terms</h2>
          <p>By creating an account or using the Ahava Healthcare platform (&ldquo;Platform&rdquo;), you agree to these Terms of Service. If you do not agree, do not use the Platform. These terms are governed by the laws of the Republic of South Africa.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>2. Description of Service</h2>
          <p>Ahava Healthcare is a digital health coordination platform that connects patients with registered nurses and doctors for home visits, remote monitoring, and health tracking. The Platform is not an emergency service. In case of a medical emergency, call 112 or your local emergency number immediately.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>3. Eligibility</h2>
          <p>You must be at least 18 years old to register an account. By registering, you confirm you are 18 or older, or have the consent of a parent or legal guardian.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>4. User Accounts</h2>
          <ul>
            <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
            <li>You must provide accurate and truthful information during registration.</li>
            <li>You must notify us immediately of any unauthorised use of your account.</li>
            <li>One person per account — accounts may not be shared.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>5. Healthcare Disclaimer</h2>
          <p>The Platform facilitates connections between patients and healthcare professionals. AI-generated health insights are for informational purposes only and do not constitute medical advice, diagnosis, or treatment. Always consult a qualified healthcare professional for medical decisions. Ahava Healthcare is not liable for outcomes arising from reliance on AI-generated content.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>6. Wearable Device Integration (Beta)</h2>
          <p>The wearable device integration feature is currently in beta. Wearable data is used to provide health insights and is processed in accordance with our Privacy Policy. Wearable device data is not a substitute for professional medical monitoring.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>7. Prohibited Conduct</h2>
          <p>You may not:</p>
          <ul>
            <li>Use the Platform for any unlawful purpose.</li>
            <li>Provide false health information that may endanger others.</li>
            <li>Attempt to gain unauthorised access to other users&apos; data.</li>
            <li>Abuse, harass, or threaten healthcare professionals on the Platform.</li>
            <li>Reverse-engineer or scrape the Platform.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>8. Payments</h2>
          <p>Certain services on the Platform require payment. All fees are displayed before purchase. Refunds are subject to our refund policy, available on request. We use secure third-party payment processors and do not store card details.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>9. Intellectual Property</h2>
          <p>All Platform content, including software, design, and AI models, is owned by Ahava Healthcare or its licensors. You may not copy, distribute, or create derivative works without written permission.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>10. Limitation of Liability</h2>
          <p>To the maximum extent permitted by South African law, Ahava Healthcare shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Platform. Our total liability to you shall not exceed the amount you paid to us in the 12 months preceding the claim.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>11. Termination</h2>
          <p>We reserve the right to suspend or terminate your account for violations of these Terms. You may delete your account at any time by contacting support.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>12. Changes to Terms</h2>
          <p>We may update these Terms from time to time. We will notify you by email of material changes. Continued use of the Platform after notification constitutes acceptance.</p>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>13. Contact</h2>
          <p>For questions about these Terms, contact us at: <strong>legal@ahavahealthcare.co.za</strong></p>

        </div>
      </div>
    </div>
  );
}
