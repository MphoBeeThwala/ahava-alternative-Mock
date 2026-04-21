# Healthcare Worker Quick Start Guide

## Overview

Welcome to the Ahava Healthcare AI Diagnosis System! This guide will help you understand how to review cases, use the AI analysis, and manage patient care effectively.

---

## Getting Started

### 1. Set Your Specialty

When creating your profile or in settings:
- Select your medical specialty (e.g., DERMATOLOGY, CARDIOLOGY, GENERAL_PRACTICE)
- This determines which cases are automatically assigned to you
- You can still view and claim cases from other specialties if qualified

### 2. Verification Status

- Your account must be verified by an admin before you can review cases
- Verification involves checking your professional credentials (SANC ID for nurses, medical license for doctors)
- Once verified, you'll see cases in your dashboard

---

## Viewing Cases

### Your Dashboard

Cases are displayed with:
- **Priority Badge**: URGENT (red), HIGH (orange), MEDIUM (yellow), LOW (green)
- **Specialty**: Assigned medical discipline
- **Patient Info**: Name and submission time
- **Status**: Pending Review, Under Review, or Released

### Filtering Options

Access via API query parameters:
- `?assigned=true` - Only cases assigned to you or matching your specialty
- `?status=pending` - Only unreleased cases needing review
- `?status=all` - All cases (including completed)

### Priority Sorting

Cases automatically sorted by priority:
1. **URGENT** - Life-threatening conditions (chest pain, severe bleeding)
2. **HIGH** - Serious conditions requiring prompt attention
3. **MEDIUM** - Standard medical concerns
4. **LOW** - Minor issues, routine checkups

---

## Reviewing a Case

### Step 1: Claim the Case

If case is unassigned or available to your specialty:
```
POST /api/diagnostic-reports/{id}/claim
```
This assigns the case to you exclusively.

### Step 2: Review AI Analysis

The AI has already analyzed:

#### A. Symptom Analysis
- Patient's description of symptoms
- Preliminary diagnostic assessment
- Possible conditions (2-4 most likely)
- Confidence score (0.0 to 1.0)

#### B. Image Analysis (if provided)
- Clinical observations from medical images
- Pathological findings
- Concerning features identified
- Image types (X-ray, CT, MRI, photos, etc.)

#### C. Biometric Data
Recent readings from wearable devices:
- Heart Rate (HR)
- Heart Rate Variability (HRV)
- Blood Oxygen (SpO2)
- Respiratory Rate
- Skin Temperature

#### D. Patient Baseline
If patient has established baseline:
- Normal values for their physiology
- Deviations from their personal baseline
- Trends over time

### Step 3: Review Medical Images

Click on any uploaded images to view full resolution:
- **SYMPTOM_PHOTO**: Photos of visible symptoms
- **XRAY**: X-ray imaging
- **CT_SCAN**: CT scan results
- **MRI**: MRI imaging
- **ULTRASOUND**: Ultrasound images
- **ECG**: ECG readings
- **DERMATOLOGY_PHOTO**: Skin condition photos
- **DENTAL_XRAY / DENTAL_PHOTO**: Dental imagery
- **OTHER**: Other medical imagery

### Step 4: Add Your Assessment

```
POST /api/diagnostic-reports/{id}/review
{
  "doctor_notes": "Your detailed clinical assessment",
  "diagnosis": "Your final diagnosis",
  "recommendations": "Treatment plan and follow-up actions"
}
```

#### Best Practices for Assessment:

**Doctor Notes:**
- Reference the AI findings: agree, disagree, or expand
- Note any additional observations from images/data
- Document your clinical reasoning
- Include differential diagnoses considered

**Diagnosis:**
- Clear, specific diagnosis
- ICD-10 codes if applicable
- Severity assessment
- Prognosis

**Recommendations:**
- Treatment plan (medications, procedures)
- Lifestyle modifications
- Follow-up schedule
- When to seek emergency care
- Referrals to other specialists if needed

### Step 5: Release to Patient

Once satisfied with your assessment:
```
POST /api/diagnostic-reports/{id}/release
```

Patient will receive notification and can view the complete report in their Diagnostic Vault.

---

## Handling Escalation Requests

### Patient Requests Escalation

Patients can request their case be escalated to a specialist (e.g., from GP to Cardiologist).

### Your Decision Process

Review:
1. **Medical Necessity**: Does the case warrant specialist care?
2. **AI Confidence**: Was confidence score low, suggesting complexity?
3. **Image Findings**: Do images show specialist-level concerns?
4. **Patient History**: Any complicating factors?
5. **Cost Impact**: Patient understands cost will increase?

### Approve Escalation

```
POST /api/diagnostic-reports/{id}/approve-escalation
{
  "approve": true
}
```

Result:
- Case reassigned to specialist in requested specialty
- Patient charged escalated cost
- Original report remains in history
- Specialist completes new assessment

### Decline Escalation

```
POST /api/diagnostic-reports/{id}/approve-escalation
{
  "approve": false,
  "reason": "Explanation for patient"
}
```

Provide clear reasoning:
- "Current assessment is comprehensive and specialist input not medically necessary"
- "Condition can be managed at general practice level with proper follow-up"
- "Recommend trying initial treatment before specialist referral"

---

## Understanding AI Confidence Scores

The AI provides a confidence score with each analysis:

- **0.8 - 1.0 (High)**: AI is very confident, findings align with clear condition
- **0.6 - 0.8 (Medium)**: Reasonable confidence, some ambiguity present
- **0.4 - 0.6 (Low)**: Uncertain, multiple possible conditions
- **0.0 - 0.4 (Very Low)**: High uncertainty, requires careful expert review

**Your Role:**
- High confidence: Verify AI reasoning, ensure nothing missed
- Low confidence: Critical expert judgment needed, AI needs your expertise

---

## Working with AI Analysis

### When to Agree with AI
- Analysis aligns with your clinical judgment
- Image findings support AI conclusions
- Biometrics corroborate symptoms
- Confidence score is reasonable

### When to Disagree with AI
- Clinical experience suggests different diagnosis
- Images show features AI missed
- Patient history not fully considered by AI
- Rare condition AI might not recognize

### Document Your Reasoning
Always explain:
- Why you agree or disagree with AI
- Additional factors you considered
- How you reached your conclusion

This helps:
- Future AI improvements
- Audit trail for medical-legal purposes
- Patient understanding
- Quality assurance

---

## Cost Structure (for Reference)

When advising patients on escalation, be aware of cost implications:

### Base Costs by Specialty
- Nursing: R500
- General Practice: R800
- Dermatology: R1,200
- Dentistry: R1,500
- Most specialists: R1,200 - R2,000
- Emergency: R3,000

### Priority Multipliers
- LOW: 80% of base
- MEDIUM: 100% of base
- HIGH: 130% of base
- URGENT: 150% of base

**Example:**
- Patient seen by GP for chest pain (MEDIUM) = R800
- Escalation to Cardiologist (MEDIUM) = R2,000
- Additional cost to patient = R1,200

---

## Best Practices

### 1. Timeliness
- URGENT cases: Review within 1 hour
- HIGH cases: Review within 4 hours
- MEDIUM cases: Review within 24 hours
- LOW cases: Review within 48 hours

### 2. Thoroughness
- Review ALL provided information (symptoms, images, biometrics)
- Don't rely solely on AI analysis
- Look for what AI might have missed
- Consider patient context

### 3. Communication
- Write patient-friendly explanations
- Avoid excessive medical jargon (or explain terms)
- Be empathetic and supportive
- Provide clear next steps

### 4. Image Review
- View all images at full resolution
- Look for subtle findings
- Compare with biometric data
- Note image quality issues

### 5. Escalation Guidance
- Be honest about case complexity
- Advocate for patient's best care
- Balance cost concerns with medical necessity
- Suggest escalation when appropriate

### 6. Documentation
- Complete, accurate, legible notes
- Include all relevant findings
- Document differential diagnoses
- Record follow-up plan

---

## Common Scenarios

### Scenario 1: Simple Dermatology Case
**Input:**
- Symptoms: "Itchy red rash on arms for 3 days"
- Image: Clear photo of contact dermatitis
- AI Confidence: 0.85
- Priority: LOW

**Your Response:**
- Confirm diagnosis: Contact dermatitis
- Recommend: OTC hydrocortisone cream, avoid irritants
- Follow-up: 1 week if not improving
- Release report

**Time: 10 minutes**

### Scenario 2: Complex Cardiology Case
**Input:**
- Symptoms: "Chest tightness during exercise, family history of heart disease"
- ECG image provided
- Biometrics: Elevated HR, low HRV
- AI Confidence: 0.55
- Priority: HIGH
- AI suggests: Possible angina

**Your Response:**
- Detailed review of ECG
- Note: AI flagged concerning features correctly
- Diagnosis: Likely stable angina, rule out MI
- Recommendations: 
  - Urgent cardiology workup
  - Stress test
  - Avoid strenuous activity until evaluated
  - Emergency signs to watch for
- Consider: Suggest cardiology escalation if you're GP
- Release report with urgency note

**Time: 20-30 minutes**

### Scenario 3: Escalation Request
**Input:**
- Original case: Skin lesion reviewed by GP
- Patient requests dermatology escalation
- Reason: "Wants specialist opinion on mole"
- Images show: Asymmetric, irregular borders

**Your Response:**
- Review: Lesion does have concerning features (ABCDE criteria)
- Decision: APPROVE escalation
- Reasoning: "Dermatoscopy by dermatologist warranted for atypical features"
- Patient informed of R1,200 → R1,500 cost

**Time: 10 minutes**

---

## Troubleshooting

### "Can't see any cases"
- Verify your account is verified by admin
- Check that your specialty is set in your profile
- Try viewing all cases (not just assigned=true)

### "AI analysis seems incorrect"
- Trust your clinical judgment - you're the expert
- Document why you disagree
- Proceed with your assessment
- This feedback helps improve the AI

### "Images won't load"
- Check internet connection
- Verify image URLs are accessible
- Contact admin if persistent issues
- Proceed with symptom analysis if possible

### "Patient biometrics look wrong"
- Wearable devices can malfunction
- Note discrepancy in your assessment
- Rely on symptoms and images more heavily
- Consider recommending in-person measurement

---

## Emergency Protocols

### URGENT Priority Cases

If you see URGENT priority:
1. **Immediate Review**: Drop other tasks
2. **Quick Assessment**: Is patient in immediate danger?
3. **Emergency Services**: If life-threatening, note patient should call 10177
4. **Fast Turnaround**: Complete review within 1 hour
5. **Clear Instructions**: Emergency signs, when to go to ER

### Chest Pain Protocol
- Always treat as potential cardiac emergency
- Recommend emergency evaluation if:
  - Crushing/squeezing chest pain
  - Radiation to arm/jaw
  - Shortness of breath
  - Sweating, nausea
- Note: "Call 10177 immediately if symptoms worsen"

### Stroke Symptoms
- Immediate emergency services
- FAST assessment (Face, Arms, Speech, Time)
- No time for AI analysis - direct to ER
- Document recommendation clearly

---

## Quality Assurance

Your reviews may be audited for:
- Accuracy of diagnosis
- Completeness of documentation
- Timeliness of response
- Appropriate escalation decisions
- Patient outcome correlation

Maintain high standards:
- Evidence-based decisions
- Current medical guidelines
- Professional communication
- Ethical escalation practices

---

## Continuous Improvement

### Provide Feedback
- Note when AI is particularly helpful
- Report when AI analysis is incorrect
- Suggest features or improvements
- Share best practices with colleagues

### Stay Updated
- Medical guidelines change
- AI models improve over time
- New features added regularly
- Review documentation periodically

---

## Support

**Technical Issues:**
- Contact: tech@ahavahealthcare.com
- Discord: https://discord.gg/shDEGBSe2d

**Medical-Legal Questions:**
- Contact: legal@ahavahealthcare.com

**Clinical Collaboration:**
- Discuss complex cases with colleagues
- Use internal messaging system
- Request peer review when needed

---

## Remember

**You are the expert.** The AI is a powerful tool to assist you, but your clinical judgment, experience, and expertise are paramount. Always trust your professional assessment and document your reasoning clearly.

**Patient care comes first.** Prioritize patient safety and well-being over efficiency. Take the time needed for thorough review, especially for complex or uncertain cases.

**We're here to support you.** Don't hesitate to reach out with questions, concerns, or feedback. Your input helps make the platform better for everyone.

---

**Welcome to the Ahava Healthcare team!** 🏥

Together, we're revolutionizing healthcare delivery in South Africa through the intelligent combination of AI technology and expert human care.

**Last Updated**: January 2026

