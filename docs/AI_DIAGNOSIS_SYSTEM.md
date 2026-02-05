# AI Symptoms and Diagnosis System

## Overview

The Ahava Healthcare platform now features a comprehensive AI-powered symptoms and diagnosis system that intelligently routes cases to appropriate healthcare professionals based on symptom analysis, medical imaging, and biometric data from wearable devices.

## System Architecture

### 1. Patient Input Methods

Patients can submit health concerns through multiple channels:

#### A. Text-Based Symptom Description
- Detailed description of symptoms
- Duration and severity
- Triggers and patterns
- Current medications and conditions

#### B. Medical Image Upload (Up to 5 images)
Supported image types:
- **Symptom Photos**: Visible symptoms like rashes, wounds, swelling
- **X-Rays**: Bone fractures, dental issues
- **CT Scans**: Detailed cross-sectional imaging
- **MRI**: Soft tissue imaging
- **Ultrasound**: Pregnancy, organ imaging
- **ECG**: Heart rhythm analysis
- **Dermatology Photos**: Skin conditions
- **Dental Imagery**: Dental X-rays and photos
- **Other Medical Imagery**: Any other relevant medical images

#### C. Biometric Data Integration
Automatically incorporates recent data from wearable devices:
- Heart Rate (HR)
- Heart Rate Variability (HRV)
- Blood Oxygen Saturation (SpO2)
- Respiratory Rate
- Skin Temperature
- Patient baseline comparisons (if established)

---

## 2. AI Analysis Process

### Stage 1: Image Analysis (if images provided)
Using **Google Gemini 2.5 Flash** with vision capabilities:
- Clinical observation of visible features
- Identification of pathological findings
- Medical characteristic assessment
- Detection of concerning features

### Stage 2: Comprehensive Symptom Analysis
AI evaluates:
- Symptom descriptions
- Image analysis results
- Recent biometric data
- Patient baseline deviations
- Medical history context

### Stage 3: Diagnostic Assessment
The AI generates:
1. **Preliminary Analysis**: Detailed clinical assessment
2. **Possible Conditions**: 2-4 most likely diagnoses
3. **Confidence Score**: 0.0 to 1.0 reliability metric
4. **Recommended Specialty**: Appropriate medical discipline
5. **Priority Level**: LOW, MEDIUM, HIGH, or URGENT
6. **Recommended Actions**: Tests and next steps

---

## 3. Specialty Routing System

### Automatic Specialty Assignment

Cases are automatically routed to healthcare professionals based on:

| Specialty | Keywords/Conditions | Base Cost (ZAR) |
|-----------|-------------------|-----------------|
| **Nursing** | Monitoring, wound dressing, home care | R500 |
| **General Practice** | General medical concerns | R800 |
| **Dermatology** | Skin, rash, acne, eczema, lesions | R1,200 |
| **Dentistry** | Tooth, gum, jaw pain, cavity | R1,500 |
| **Cardiology** | Heart, chest pain, palpitations | R2,000 |
| **Neurology** | Brain, headache, seizure, stroke | R2,000 |
| **Orthopedics** | Bone, fracture, joint, back pain | R1,500 |
| **Ophthalmology** | Eye, vision problems | R1,200 |
| **ENT** | Ear, nose, throat issues | R1,200 |
| **Gastroenterology** | Stomach, digestive issues | R1,500 |
| **Pulmonology** | Lung, respiratory, breathing | R1,500 |
| **Psychiatry** | Mental health, depression, anxiety | R1,200 |
| **Urology** | Kidney, bladder, urinary issues | R1,500 |
| **Gynecology** | Pregnancy, menstrual issues | R1,500 |
| **Endocrinology** | Diabetes, thyroid, hormones | R1,500 |
| **Pediatrics** | Children's health | R1,000 |
| **Emergency Medicine** | Life-threatening emergencies | R3,000 |

### Priority-Based Cost Adjustment

Costs are adjusted based on case priority:
- **LOW**: 80% of base cost
- **MEDIUM**: 100% of base cost (standard)
- **HIGH**: 130% of base cost
- **URGENT**: 150% of base cost

---

## 4. Healthcare Professional Workflow

### Case Assignment
1. **Automatic Assignment**: System assigns cases to verified professionals matching the required specialty
2. **Manual Claiming**: Professionals can claim unassigned cases matching their specialty
3. **Queue Prioritization**: Cases sorted by URGENT → HIGH → MEDIUM → LOW

### Case Review Process
1. **View AI Analysis**: Review preliminary findings, images, and biometrics
2. **Add Professional Assessment**: Doctor/nurse notes and diagnosis
3. **Update Recommendations**: Treatment plan and follow-up actions
4. **Release to Patient**: Make report available to patient

### Viewing Assigned Cases
Healthcare workers can filter reports by:
- **Status**: Pending review vs. completed
- **Assignment**: Only cases assigned to them or matching their specialty
- **Priority**: Urgent cases highlighted

---

## 5. Escalation System

### Patient-Initiated Escalation

Patients can request escalation to a specialist if:
- Initial assessment suggests complex condition
- Second opinion desired
- Specialist care recommended

**Requirements:**
- Explicit patient consent
- Understanding of cost increase
- Valid reason (minimum 20 characters)

### Healthcare Worker Approval Process

The initially assigned healthcare worker must:
1. Review escalation request
2. Assess medical necessity
3. **Approve**: Case reassigned to specialist at new cost
4. **Decline**: Provide reason, patient continues with current care

### Cost Transparency
- Patients see estimated cost before requesting analysis
- Escalation cost shown before submitting request
- All costs in South African Rand (ZAR)

---

## 6. Technical Implementation

### Database Schema (Migration 9)

New fields in `diagnostic_reports`:
```sql
- image_urls TEXT              -- JSON array of uploaded images
- image_analysis TEXT           -- AI analysis of images
- assigned_specialty TEXT       -- Target medical specialty
- assigned_to TEXT              -- Healthcare worker user_id
- priority TEXT                 -- LOW, MEDIUM, HIGH, URGENT
- estimated_cost REAL           -- Cost for current care level
- escalation_requested INTEGER  -- Patient requested escalation
- escalation_approved INTEGER   -- First practitioner approved
- escalated_to TEXT             -- Specialist specialty
- escalated_cost REAL           -- Cost after escalation
```

New field in `profiles`:
```sql
- specialty TEXT  -- Healthcare worker's medical specialty
```

### API Endpoints

#### Patient Endpoints
```
POST /api/upload-image
  - Upload medical images to Cloudflare R2
  - Returns: { url: string }

POST /api/diagnostic-analysis
  - Submit symptoms and images for AI analysis
  - Body: { symptoms: string, images?: Array<{url, type, description}> }
  - Returns: { reportId, specialty, priority, estimatedCost }

POST /api/diagnostic-reports/:id/request-escalation
  - Request escalation to specialist
  - Body: { specialist_specialty, reason, patient_consent }
  - Returns: { escalatedCost }

GET /api/patient/diagnostic-reports
  - View released diagnostic reports
```

#### Healthcare Worker Endpoints
```
GET /api/diagnostic-reports?assigned=true&status=pending
  - View assigned cases (filtered by specialty)
  
POST /api/diagnostic-reports/:id/claim
  - Claim an unassigned case

POST /api/diagnostic-reports/:id/review
  - Add professional assessment
  - Body: { doctor_notes, diagnosis, recommendations }

POST /api/diagnostic-reports/:id/release
  - Release report to patient

POST /api/diagnostic-reports/:id/approve-escalation
  - Approve or decline escalation request
  - Body: { approve: boolean, reason?: string }
```

### AI Integration

**Model**: Google Gemini 2.5 Flash
- Text analysis for symptoms
- Vision capabilities for medical imaging
- JSON-structured responses for consistency
- Temperature: 0.2-0.3 for clinical precision

---

## 7. Security and Privacy

### Image Storage
- Images stored in Cloudflare R2 bucket
- Unique filename: `medical-images/{user_id}/{timestamp}-{random}.{ext}`
- Maximum file size: 10MB per image
- Supported formats: JPEG, PNG, other image formats

### Access Control
- Patients only see their own released reports
- Healthcare workers see cases matching their specialty or assigned to them
- Doctors/nurses must be verified (`is_verified = 1`)
- All endpoints protected by `authMiddleware`

### HIPAA Compliance Considerations
- Medical images encrypted in transit (HTTPS)
- Access logs for all diagnostic report views
- Patient consent required for escalation
- Medical disclaimer shown before submission

---

## 8. User Experience Flow

### Patient Journey
1. Click "AI Symptom Analysis" on dashboard
2. Describe symptoms in detail
3. (Optional) Upload up to 5 medical images
4. Select image type and add descriptions
5. Submit for analysis
6. Receive confirmation with:
   - Assigned specialty
   - Priority level
   - Estimated cost
7. Wait for healthcare professional review
8. (Optional) Request escalation if needed with consent
9. Receive notification when report is released
10. View complete diagnostic report in Diagnostic Vault

### Healthcare Worker Journey
1. View pending cases on dashboard (filtered by specialty)
2. Cases sorted by priority (URGENT first)
3. Claim unassigned case or review assigned case
4. Review:
   - Patient symptoms
   - AI preliminary analysis
   - Medical images (if provided)
   - Recent biometrics
   - Patient baseline
5. Add professional assessment
6. Make diagnosis and recommendations
7. Handle escalation requests if any
8. Release report to patient

---

## 9. Cost Examples

### Scenario 1: Skin Rash (Low Priority)
- Specialty: Dermatology (R1,200 base)
- Priority: LOW (0.8x multiplier)
- **Total: R960**

### Scenario 2: Chest Pain (Urgent)
- Specialty: Cardiology (R2,000 base)
- Priority: URGENT (1.5x multiplier)
- **Total: R3,000**

### Scenario 3: General Checkup with Escalation
- Initial: General Practice, MEDIUM (R800)
- Patient requests escalation to Cardiology
- Escalated: Cardiology, MEDIUM (R2,000)
- **Additional cost: R1,200**

---

## 10. Future Enhancements

### Planned Features
- [ ] Integration with diagnostic lab results
- [ ] Prescription management system
- [ ] Telemedicine video consultations
- [ ] Follow-up appointment scheduling
- [ ] Patient symptom tracking over time
- [ ] AI learning from doctor corrections
- [ ] Multi-language support
- [ ] Voice-to-text symptom description
- [ ] Integration with more wearable devices
- [ ] Pharmacy medication delivery

### AI Improvements
- Fine-tune specialty determination algorithm
- Train custom medical vision model
- Expand medical condition database
- Incorporate medical literature references
- Add differential diagnosis reasoning

---

## 11. Configuration Requirements

### Environment Variables
```bash
# Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# Cloudflare R2 Storage
MEDICAL_IMAGES_BUCKET=your_r2_bucket_name
PUBLIC_BUCKET_URL=https://your-bucket-url.com

# Database
DB=your_cloudflare_d1_database
```

### Database Migration
Run migration 9 to add new fields:
```bash
wrangler d1 execute DB --file=./migrations/9.sql
```

---

## 12. Testing Recommendations

### Test Cases
1. **Symptom-only submission** (text description)
2. **Symptom with single image** (dermatology case)
3. **Multiple images** (dental X-ray + photo)
4. **High-priority case** (chest pain)
5. **Escalation workflow** (GP → Cardiologist)
6. **Healthcare worker claiming** (unassigned case)
7. **Multiple specialties** (verify correct routing)
8. **Cost calculations** (various priority levels)

### Performance Metrics
- AI analysis response time: < 10 seconds
- Image upload time: < 5 seconds per image
- Case assignment time: < 1 second
- End-to-end patient experience: < 24 hours

---

## Support and Maintenance

For technical issues or questions:
- Review API error responses in browser console
- Check Cloudflare Workers logs for backend errors
- Verify Gemini API quota and limits
- Ensure R2 bucket permissions are correct

---

**Last Updated**: January 2026
**Version**: 1.0.0

