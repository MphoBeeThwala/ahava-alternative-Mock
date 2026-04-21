import { AlertTriangle, Shield, FileText } from "lucide-react";

interface MedicalDisclaimerProps {
  onAccept: () => void;
  onDecline: () => void;
}

export default function MedicalDisclaimer({ onAccept, onDecline }: MedicalDisclaimerProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-amber-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Medical Disclaimer & Terms of Use</h2>
        <p className="text-gray-600">Please read carefully before continuing</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg max-h-[60vh] overflow-y-auto p-6 space-y-6">
        {/* Medical Disclaimer */}
        <div>
          <div className="flex items-center mb-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mr-2" />
            <h3 className="text-lg font-bold text-gray-900">Medical Disclaimer</h3>
          </div>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <p className="font-semibold text-amber-700">
              THIS PLATFORM PROVIDES HEALTH INFORMATION AND CONNECTS YOU WITH HEALTHCARE PROFESSIONALS. 
              IT IS NOT A SUBSTITUTE FOR PROFESSIONAL MEDICAL ADVICE, DIAGNOSIS, OR TREATMENT.
            </p>
            
            <p>
              <strong>Human-in-the-Loop Requirement:</strong> All AI-generated diagnostic analyses are 
              preliminary and MUST be reviewed by a qualified, licensed doctor before being released to 
              patients. No AI diagnosis is final until verified by a medical professional.
            </p>

            <p>
              <strong>Emergency Services:</strong> In case of a medical emergency, immediately call 10177 
              (South African Emergency Services) or go to your nearest emergency room. Do not rely on this 
              platform for emergency medical situations.
            </p>

            <p>
              <strong>No Doctor-Patient Relationship:</strong> Use of this platform does not create a 
              doctor-patient relationship. Healthcare professionals on this platform provide services 
              independently and are responsible for their own professional conduct.
            </p>

            <p>
              <strong>Information Accuracy:</strong> While we strive for accuracy, health information and 
              AI analyses may not be complete or up-to-date. Always verify information with a qualified 
              healthcare provider.
            </p>

            <p>
              <strong>Biometric Data:</strong> Biometric readings from wearable devices may have limitations 
              and should not be the sole basis for medical decisions. Consult a healthcare provider for 
              proper interpretation.
            </p>
          </div>
        </div>

        {/* POPIA Compliance */}
        <div>
          <div className="flex items-center mb-3">
            <Shield className="w-5 h-5 text-blue-600 mr-2" />
            <h3 className="text-lg font-bold text-gray-900">Privacy & POPIA Compliance</h3>
          </div>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <p>
              Ahava Healthcare complies with the Protection of Personal Information Act (POPIA) of South Africa. 
              By using this platform:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>You consent to the collection, processing, and storage of your personal and health information</li>
              <li>Your data will be used to provide healthcare services, improve platform functionality, and comply with legal obligations</li>
              <li>Your information may be shared with healthcare professionals treating you (nurses, doctors)</li>
              <li>We implement appropriate security measures to protect your data</li>
              <li>You have the right to access, correct, or delete your personal information</li>
              <li>You may withdraw consent at any time by contacting support, though this may limit service availability</li>
            </ul>
          </div>
        </div>

        {/* Terms of Use */}
        <div>
          <div className="flex items-center mb-3">
            <FileText className="w-5 h-5 text-purple-600 mr-2" />
            <h3 className="text-lg font-bold text-gray-900">Terms of Use</h3>
          </div>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <p><strong>User Responsibilities:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Provide accurate and truthful information about your health and identity</li>
              <li>Keep your account credentials secure and confidential</li>
              <li>Use the platform in compliance with applicable laws and regulations</li>
              <li>Respect the professional boundaries of healthcare providers</li>
            </ul>

            <p><strong>Healthcare Provider Verification:</strong></p>
            <p>
              Nurses and doctors must provide valid SANC (South African Nursing Council) registration. 
              We verify credentials, but users should independently confirm provider qualifications.
            </p>

            <p><strong>Service Availability:</strong></p>
            <p>
              Services are provided "as is" without warranties. We do not guarantee uninterrupted access 
              or that the platform will meet all your healthcare needs.
            </p>

            <p><strong>Limitation of Liability:</strong></p>
            <p>
              Ahava Healthcare and its operators are not liable for any direct, indirect, or consequential 
              damages arising from use of this platform, including medical outcomes from services rendered 
              by independent healthcare providers.
            </p>

            <p><strong>Changes to Terms:</strong></p>
            <p>
              We may update these terms periodically. Continued use after changes constitutes acceptance 
              of new terms.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          <strong>By clicking "I Accept", you acknowledge that you have read, understood, and agree to be bound by 
          this Medical Disclaimer and Terms of Use, including POPIA consent provisions.</strong>
        </p>
      </div>

      <div className="flex gap-4">
        <button
          onClick={onDecline}
          className="flex-1 px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          I Decline
        </button>
        <button
          onClick={onAccept}
          className="flex-1 px-6 py-3 bg-[#004aad] text-white rounded-lg font-medium hover:bg-[#003a8c] transition-colors"
        >
          I Accept
        </button>
      </div>
    </div>
  );
}
