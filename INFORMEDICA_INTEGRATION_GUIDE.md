# 💊 Informedica API Integration Guide

## 🎯 Overview

Informedica provides medical decision support APIs for:
- Drug interaction checking
- Medication information
- Dosage calculations
- Clinical decision support
- Patient safety alerts

Looking at their website, they offer two APIs:

### **Platform API** (Recommended for Ahava)
- Streamlined, pre-configured medical interviews
- Quick implementation
- Stateful (maintains session context)
- **Best for:** Standard medication checks and drug interactions

### **Engine API** (Advanced)
- Highly flexible, customizable
- Bespoke implementations
- Stateless
- **Best for:** Complex custom workflows

**For Ahava Platform, start with Platform API** ✅

---

## 📝 Step 1: Get API Access

### On the Informedica Website (Where You Are Now):

1. **Click "Get in touch"** button (top right or in the main area)

2. **Fill out the contact form** with:
   - Company name: Ahava Healthcare
   - Email: Your business email
   - Use case: "Telemedicine platform for South Africa - need medication safety checking and drug interaction API"
   - Country: South Africa

3. **Request information about:**
   - API pricing for healthcare startups
   - Free trial or sandbox environment
   - South African medication database availability
   - Integration timeline
   - API documentation access

4. **Alternative: Click "See API overview"** to view documentation first

### What to Ask For:
- **API Key** or OAuth credentials
- **Base URL** for API endpoints
- **Documentation** (API reference, integration guide)
- **Sandbox/Test environment** for development
- **Pricing** information (monthly/per-request)
- **South African medicine database** availability

---

## 🔑 Step 2: Environment Variables Setup

Once you get your API credentials, add them to your project:

### Add to `.dev.vars` (Local Development):

```bash
# Informedica API
INFORMEDICA_API_KEY=your_api_key_here
INFORMEDICA_API_URL=https://api.informedica.nl/v1
INFORMEDICA_CLIENT_ID=your_client_id_here
INFORMEDICA_CLIENT_SECRET=your_client_secret_here
```

### Add to `env.example`:

```bash
# Informedica Medication API
INFORMEDICA_API_KEY=your_informedica_api_key
INFORMEDICA_API_URL=https://api.informedica.nl/v1
INFORMEDICA_CLIENT_ID=your_client_id
INFORMEDICA_CLIENT_SECRET=your_client_secret
```

### Set Production Secrets (Later):

```powershell
npx wrangler secret put INFORMEDICA_API_KEY
npx wrangler secret put INFORMEDICA_CLIENT_ID
npx wrangler secret put INFORMEDICA_CLIENT_SECRET
```

---

## 💻 Step 3: Create Informedica Integration

### Create `src/lib/informedica.ts`:

```typescript
/**
 * Informedica API Integration
 * Provides medication information, drug interactions, and clinical decision support
 */

interface InformedicaConfig {
  apiKey: string;
  apiUrl: string;
  clientId?: string;
  clientSecret?: string;
}

interface DrugInteraction {
  severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  description: string;
  recommendation: string;
  drugs: string[];
}

interface MedicationInfo {
  name: string;
  genericName: string;
  dosage: string;
  sideEffects: string[];
  contraindications: string[];
  interactions: DrugInteraction[];
}

interface DosageRecommendation {
  medication: string;
  recommendedDose: string;
  frequency: string;
  duration: string;
  warnings: string[];
}

export class InformedicaClient {
  private config: InformedicaConfig;

  constructor(config: InformedicaConfig) {
    this.config = config;
  }

  /**
   * Check for drug interactions between multiple medications
   */
  async checkDrugInteractions(medications: string[]): Promise<DrugInteraction[]> {
    try {
      const response = await fetch(`${this.config.apiUrl}/interactions/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-Client-ID': this.config.clientId || '',
        },
        body: JSON.stringify({
          medications: medications,
          country: 'ZA', // South Africa
        }),
      });

      if (!response.ok) {
        throw new Error(`Informedica API error: ${response.status}`);
      }

      const data = await response.json();
      return data.interactions || [];
    } catch (error) {
      console.error('Drug interaction check failed:', error);
      throw error;
    }
  }

  /**
   * Get detailed information about a medication
   */
  async getMedicationInfo(medicationName: string): Promise<MedicationInfo> {
    try {
      const response = await fetch(
        `${this.config.apiUrl}/medications/${encodeURIComponent(medicationName)}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'X-Client-ID': this.config.clientId || '',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Medication not found: ${medicationName}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Medication info fetch failed:', error);
      throw error;
    }
  }

  /**
   * Calculate appropriate dosage for a patient
   */
  async calculateDosage(params: {
    medication: string;
    patientAge: number;
    patientWeight: number;
    condition: string;
    otherMedications?: string[];
  }): Promise<DosageRecommendation> {
    try {
      const response = await fetch(`${this.config.apiUrl}/dosage/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-Client-ID': this.config.clientId || '',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error('Dosage calculation failed');
      }

      return await response.json();
    } catch (error) {
      console.error('Dosage calculation failed:', error);
      throw error;
    }
  }

  /**
   * Search for medications by name or condition
   */
  async searchMedications(query: string): Promise<Array<{ name: string; genericName: string; id: string }>> {
    try {
      const response = await fetch(
        `${this.config.apiUrl}/medications/search?q=${encodeURIComponent(query)}&country=ZA`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'X-Client-ID': this.config.clientId || '',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Medication search failed');
      }

      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.error('Medication search failed:', error);
      return [];
    }
  }

  /**
   * Get contraindications for a medication based on patient conditions
   */
  async checkContraindications(params: {
    medication: string;
    conditions: string[];
    allergies: string[];
  }): Promise<{ safe: boolean; warnings: string[]; contraindications: string[] }> {
    try {
      const response = await fetch(`${this.config.apiUrl}/contraindications/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-Client-ID': this.config.clientId || '',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error('Contraindication check failed');
      }

      return await response.json();
    } catch (error) {
      console.error('Contraindication check failed:', error);
      throw error;
    }
  }
}

/**
 * Create Informedica client instance
 */
export function createInformedicaClient(env: {
  INFORMEDICA_API_KEY?: string;
  INFORMEDICA_API_URL?: string;
  INFORMEDICA_CLIENT_ID?: string;
  INFORMEDICA_CLIENT_SECRET?: string;
}): InformedicaClient | null {
  if (!env.INFORMEDICA_API_KEY || !env.INFORMEDICA_API_URL) {
    console.warn('Informedica API not configured');
    return null;
  }

  return new InformedicaClient({
    apiKey: env.INFORMEDICA_API_KEY,
    apiUrl: env.INFORMEDICA_API_URL,
    clientId: env.INFORMEDICA_CLIENT_ID,
    clientSecret: env.INFORMEDICA_CLIENT_SECRET,
  });
}
```

---

## 🔌 Step 4: Add API Endpoints to Worker

### Update `src/worker/index.ts`:

Add these new endpoints:

```typescript
import { createInformedicaClient } from '../lib/informedica';

// Check drug interactions
app.post("/api/medications/check-interactions", 
  authMiddleware,
  rateLimit(RateLimits.MODERATE),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json();
    const { medications } = body;

    if (!medications || !Array.isArray(medications) || medications.length === 0) {
      return c.json({ error: "Medications array required" }, 400);
    }

    try {
      const informedica = createInformedicaClient(c.env);
      
      if (!informedica) {
        return c.json({ 
          error: "Medication checking not available",
          message: "Informedica API not configured"
        }, 503);
      }

      const interactions = await informedica.checkDrugInteractions(medications);

      // Log for audit
      await logAudit(
        c.env.DB,
        user.id,
        "DRUG_INTERACTION_CHECK",
        "Medication",
        medications.join(", "),
        c.req.header("CF-Connecting-IP"),
        c.req.header("User-Agent")
      );

      return c.json({ 
        success: true,
        interactions,
        hasCriticalInteractions: interactions.some(i => i.severity === 'CRITICAL'),
      });
    } catch (error) {
      console.error("Drug interaction check error:", error);
      return c.json({ 
        error: "Failed to check drug interactions",
        message: error instanceof Error ? error.message : "Unknown error"
      }, 500);
    }
});

// Get medication information
app.get("/api/medications/:name", 
  authMiddleware,
  rateLimit(RateLimits.MODERATE),
  async (c) => {
    const medicationName = c.req.param("name");

    try {
      const informedica = createInformedicaClient(c.env);
      
      if (!informedica) {
        return c.json({ error: "Medication info not available" }, 503);
      }

      const info = await informedica.getMedicationInfo(medicationName);

      return c.json({ success: true, medication: info });
    } catch (error) {
      console.error("Medication info error:", error);
      return c.json({ 
        error: "Medication not found",
        message: error instanceof Error ? error.message : "Unknown error"
      }, 404);
    }
});

// Search medications
app.get("/api/medications/search/:query", 
  authMiddleware,
  rateLimit(RateLimits.MODERATE),
  async (c) => {
    const query = c.req.param("query");

    try {
      const informedica = createInformedicaClient(c.env);
      
      if (!informedica) {
        return c.json({ error: "Medication search not available" }, 503);
      }

      const results = await informedica.searchMedications(query);

      return c.json({ success: true, results });
    } catch (error) {
      console.error("Medication search error:", error);
      return c.json({ error: "Search failed" }, 500);
    }
});

// Calculate dosage recommendation
app.post("/api/medications/calculate-dosage", 
  authMiddleware,
  rateLimit(RateLimits.STRICT),
  async (c) => {
    const user = c.get("user");
    const body = await c.req.json();

    try {
      const informedica = createInformedicaClient(c.env);
      
      if (!informedica) {
        return c.json({ error: "Dosage calculation not available" }, 503);
      }

      const recommendation = await informedica.calculateDosage(body);

      // Log for audit
      await logAudit(
        c.env.DB,
        user.id,
        "DOSAGE_CALCULATION",
        "Medication",
        body.medication,
        c.req.header("CF-Connecting-IP"),
        c.req.header("User-Agent")
      );

      return c.json({ success: true, recommendation });
    } catch (error) {
      console.error("Dosage calculation error:", error);
      return c.json({ error: "Calculation failed" }, 500);
    }
});
```

---

## 🎨 Step 5: Add Frontend Components

### Create Medication Checker Component

```typescript
// src/react-app/components/MedicationChecker.tsx
import { useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

export default function MedicationChecker() {
  const [medications, setMedications] = useState<string[]>(['']);
  const [interactions, setInteractions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const addMedication = () => {
    setMedications([...medications, '']);
  };

  const updateMedication = (index: number, value: string) => {
    const updated = [...medications];
    updated[index] = value;
    setMedications(updated);
  };

  const checkInteractions = async () => {
    setLoading(true);
    try {
      const validMeds = medications.filter(m => m.trim().length > 0);
      
      const response = await fetch('/api/medications/check-interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medications: validMeds }),
      });

      const data = await response.json();
      
      if (data.success) {
        setInteractions(data.interactions);
      }
    } catch (error) {
      console.error('Failed to check interactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'bg-red-100 text-red-800 border-red-300';
      case 'HIGH': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'MODERATE': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Drug Interaction Checker</h2>

      <div className="space-y-3 mb-4">
        {medications.map((med, index) => (
          <div key={index} className="flex gap-2">
            <input
              type="text"
              value={med}
              onChange={(e) => updateMedication(index, e.target.value)}
              placeholder={`Medication ${index + 1}`}
              className="flex-1 px-3 py-2 border rounded"
            />
            {medications.length > 1 && (
              <button
                onClick={() => setMedications(medications.filter((_, i) => i !== index))}
                className="p-2 text-red-600 hover:bg-red-50 rounded"
              >
                <X size={20} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={addMedication}
          className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
        >
          Add Medication
        </button>
        <button
          onClick={checkInteractions}
          disabled={loading || medications.filter(m => m.trim()).length < 2}
          className="px-4 py-2 bg-[#004aad] text-white rounded hover:bg-[#003d8f] disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Check Interactions'}
        </button>
      </div>

      {interactions.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-lg">Results:</h3>
          {interactions.map((interaction, index) => (
            <div
              key={index}
              className={`border-l-4 p-4 rounded ${getSeverityColor(interaction.severity)}`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle size={20} className="mt-0.5" />
                <div>
                  <p className="font-semibold">{interaction.severity} Interaction</p>
                  <p className="text-sm mt-1">{interaction.description}</p>
                  <p className="text-sm mt-2"><strong>Recommendation:</strong> {interaction.recommendation}</p>
                  <p className="text-xs mt-1">Drugs: {interaction.drugs.join(', ')}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {interactions.length === 0 && medications.some(m => m.trim()) && !loading && (
        <div className="flex items-center gap-2 text-green-600 bg-green-50 p-4 rounded">
          <Check size={20} />
          <p>No interactions found (if checked)</p>
        </div>
      )}
    </div>
  );
}
```

---

## 📊 Step 6: Update TypeScript Types

### Add to `src/worker/types.d.ts`:

```typescript
export interface Env {
  // ... existing env vars ...
  
  // Informedica
  INFORMEDICA_API_KEY?: string;
  INFORMEDICA_API_URL?: string;
  INFORMEDICA_CLIENT_ID?: string;
  INFORMEDICA_CLIENT_SECRET?: string;
}
```

---

## 🧪 Step 7: Testing

### Test Endpoints (Once API is configured):

```bash
# Test drug interaction check
curl -X POST http://localhost:5173/api/medications/check-interactions \
  -H "Content-Type: application/json" \
  -d '{"medications": ["Aspirin", "Warfarin", "Ibuprofen"]}'

# Test medication search
curl http://localhost:5173/api/medications/search/paracetamol

# Test medication info
curl http://localhost:5173/api/medications/Paracetamol
```

---

## 📝 Step 8: What to Tell Informedica

When you contact them, mention:

### Your Use Case:
"We're building **Ahava Healthcare**, a telemedicine platform for South Africa that connects patients with nurses and doctors for home healthcare. We need medication safety checking to:

- Check drug interactions when doctors prescribe medications
- Provide medication information to healthcare workers
- Calculate safe dosages for patients
- Alert healthcare providers to contraindications
- Ensure patient safety with automated checks

We're particularly interested in:
- South African medicine database (SAHPRA registered medications)
- Real-time drug interaction checking
- Clinical decision support
- Integration with our AI diagnostic system

Expected volume: Starting with 100-500 checks/day, growing to 5000+/day within 6 months."

### Questions to Ask:
1. Do you have South African medication database?
2. What's the pricing model? (per-request or monthly?)
3. Is there a free trial or sandbox environment?
4. What's the typical integration timeline?
5. Do you provide test credentials for development?
6. What's the API rate limit?
7. Do you support POPI Act compliance features?

---

## 💰 Expected Costs

Based on typical medication API pricing:

- **Setup/Integration:** €500-€2000 (one-time)
- **Monthly Subscription:** €200-€1000/month
- **Per-Request:** €0.01-€0.05 per API call

Or they might offer:
- Free tier for testing
- Startup discount
- Pay-as-you-grow model

---

## ✅ Integration Checklist

- [ ] Contact Informedica via "Get in touch"
- [ ] Request API documentation and pricing
- [ ] Get test/sandbox credentials
- [ ] Add credentials to `.dev.vars`
- [ ] Create `src/lib/informedica.ts` file
- [ ] Add API endpoints to worker
- [ ] Test API connectivity
- [ ] Build medication checker component
- [ ] Test drug interaction checking
- [ ] Set production secrets
- [ ] Deploy to production

---

## 🎯 Where to Add in Your App

### Doctor Dashboard:
- Drug interaction checker when writing prescriptions
- Medication information lookup
- Dosage calculator

### Diagnostic Reports:
- Automatic interaction check with current medications
- Alert doctors to potential issues
- Suggest alternative medications

### Patient Profile:
- Medication history tracking
- Interaction checking with new prescriptions
- Allergy cross-checking

### Nurse Dashboard:
- Medication administration verification
- Dosage confirmation
- Side effect information

---

## 🚀 Next Steps

**Right now:**
1. Click "Get in touch" on the Informedica website
2. Fill out the contact form
3. Request API documentation and trial access

**When you get credentials:**
1. Come back here
2. Tell me you have the API key
3. I'll help you finish the integration

**Alternative (While Waiting):**
- Deploy your platform without Informedica
- Add it later once you get API access
- Use a "Coming Soon" placeholder for medication features

---

Would you like me to help you draft the contact form message to Informedica? Or would you prefer to deploy your platform now and add Informedica later?

