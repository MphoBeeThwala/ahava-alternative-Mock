/**
 * Africa CDC / WHO AFRO Provider
 * Tier: literature
 * Purpose: SA/regional epidemiological context (TB, HIV, malaria-by-province)
 * Uses pre-ingested structured JSON data, refreshed periodically
 */

import { EvidenceProvider, EvidenceProviderConfig, ClinicalQuery, EvidenceResult } from '../types';

// SA-specific epidemiological context
// This data should be periodically refreshed from Africa CDC/WHO AFRO sources
const SA_EPIDEMIOLOGICAL_CONTEXT = {
  diseases: {
    tuberculosis: {
      name: 'Tuberculosis',
      prevalence: 'High burden - SA has one of the highest TB burdens globally',
      regions: 'All provinces',
      riskFactors: ['HIV co-infection', 'malnutrition', 'crowded living conditions'],
      symptoms: ['persistent cough', 'haemoptysis', 'night sweats', 'weight loss', 'fever'],
      recommendation: 'Consider TB in any respiratory or constitutional symptom presentation',
    },
    hiv: {
      name: 'HIV/AIDS',
      prevalence: '~13% of adult population',
      regions: 'All provinces',
      riskFactors: ['unprotected sex', 'needle sharing'],
      symptoms: ['persistent fever', 'night sweats', 'weight loss', 'chronic diarrhoea', 'oral thrush'],
      recommendation: 'Immunocompromised states can mask or alter typical presentations',
    },
    malaria: {
      name: 'Malaria',
      prevalence: 'Endemic in specific regions',
      regions: ['Limpopo', 'KwaZulu-Natal low-lying areas'],
      riskFactors: ['travel to endemic areas', 'lack of prophylaxis'],
      symptoms: ['fever', 'chills', 'cyclic fever', 'headache', 'myalgia'],
      recommendation: 'Ask about travel history to Limpopo or KwaZulu-Natal',
    },
    hypertension: {
      name: 'Hypertension',
      prevalence: 'High - leading cause of adult mortality',
      regions: 'All provinces',
      riskFactors: ['obesity', 'high salt diet', 'sedentary lifestyle', 'genetics'],
      symptoms: ['headache', 'blurred vision', 'epistaxis', 'dizziness'],
      recommendation: 'Hypertensive crisis (BP >= 220/130) requires immediate attention',
    },
    diabetes: {
      name: 'Diabetes Mellitus Type 2',
      prevalence: 'High and increasing',
      regions: 'All provinces',
      riskFactors: ['obesity', 'sedentary lifestyle', 'family history'],
      symptoms: ['excessive thirst', 'frequent urination', 'fatigue', 'blurred vision'],
      complications: ['DKA', 'hypoglycemia', 'nephropathy', 'retinopathy'],
      recommendation: 'Consider DKA in patients with uncontrolled diabetes presenting with nausea/vomiting',
    },
    pneumonia: {
      name: 'Community-Acquired Pneumonia',
      prevalence: 'Common',
      regions: 'All provinces',
      pathogens: ['Streptococcus pneumoniae', 'TB', 'Pneumocystis jirovecii (in HIV+ patients)'],
      symptoms: ['cough', 'fever', 'dyspnea', 'pleuritic chest pain'],
      recommendation: 'Consider TB and PCP in HIV-positive patients',
    },
    rheumaticHeartDisease: {
      name: 'Rheumatic Heart Disease',
      prevalence: 'Prevalent',
      regions: 'All provinces',
      cause: 'Untreated streptococcal pharyngitis',
      symptoms: ['cardiac murmur', 'heart failure', 'arrhythmias'],
      recommendation: 'Consider in patients with history of untreated sore throat',
    },
  },
  
  provinces: {
    'eastern-cape': { population: 6657169, healthFacilities: 450 },
    'free-state': { population: 2845548, healthFacilities: 320 },
    'gauteng': { population: 15498000, healthFacilities: 1200 },
    'kwazulu-natal': { population: 11482600, healthFacilities: 850, malariaRisk: true },
    'limpopo': { population: 5853700, healthFacilities: 400, malariaRisk: true },
    'mpumalanga': { population: 4644569, healthFacilities: 350 },
    'north-west': { population: 4062343, healthFacilities: 300 },
    'northern-cape': { population: 1245349, healthFacilities: 180 },
    'western-cape': { population: 6976600, healthFacilities: 600 },
  },
};

/**
 * Africa CDC Provider
 * Returns SA-specific epidemiological context based on symptoms
 */
export function africaCdcProvider(config: EvidenceProviderConfig): EvidenceProvider {
  const timeoutMs = config.timeoutMs || 5000;

  return {
    id: config.id,
    tier: 'literature',
    config,

    async query(query: ClinicalQuery): Promise<EvidenceResult[]> {
      const symptoms = (query.symptoms || '').toLowerCase();
      const patientContext = (query.patientContext || '').toLowerCase();

      const relevantContext: EvidenceResult[] = [];

      // Check for TB-related symptoms
      const tbPatterns = ['cough.*blood', 'haemoptysis', 'night sweats', 'weight loss.*unexplained', 
        'persistent cough', 'cough.*3 weeks', 'cough.*more than 2 weeks'];
      if (matchesAny(symptoms, tbPatterns)) {
        relevantContext.push({
          sourceId: 'africa-cdc',
          content: 'TB is endemic in South Africa with one of the highest burdens globally. ' +
            'Consider TB in any respiratory or constitutional symptom presentation. ' +
            'HIV co-infection is common and increases risk.',
          citation: 'Africa CDC / WHO AFRO - TB Epidemiological Data',
          confidence: 0.95,
          retrievedAt: new Date().toISOString(),
        });
      }

      // Check for HIV-related symptoms
      const hivPatterns = ['fever.*night sweats', 'chronic diarrhoea', 'oral thrush', 
        'white patches.*mouth', 'persistent fever', 'unexplained weight loss'];
      if (matchesAny(symptoms, hivPatterns) || matchesAny(patientContext, ['hiv', 'aids', 'immunocompromised'])) {
        relevantContext.push({
          sourceId: 'africa-cdc',
          content: 'HIV/AIDS prevalence is ~13% of the adult population in SA. ' +
            'Immunocompromised states can mask or alter typical presentations. ' +
            'Consider opportunistic infections in HIV-positive patients.',
          citation: 'Africa CDC / WHO AFRO - HIV Epidemiological Data',
          confidence: 0.95,
          retrievedAt: new Date().toISOString(),
        });
      }

      // Check for malaria-related symptoms + travel history
      const malariaPatterns = ['fever.*chills', 'cyclic fever', 'malaria'];
      const travelPatterns = ['travel.*limpopo', 'travel.*kwazulu', 'travel.*mozambique', 
        'travel.*zimbabwe', 'travel.*malaria'];
      if ((matchesAny(symptoms, malariaPatterns) || matchesAny(patientContext, travelPatterns)) &&
          (matchesAny(symptoms, malariaPatterns) || matchesAny(patientContext, ['limpopo', 'kwazulu', 'malaria']))) {
        relevantContext.push({
          sourceId: 'africa-cdc',
          content: 'Malaria is endemic in Limpopo and KwaZulu-Natal low-lying areas. ' +
            'Ask about travel history to these regions. ' +
            'Consider malaria in patients with cyclic fever and chills.',
          citation: 'Africa CDC / WHO AFRO - Malaria Endemic Areas',
          confidence: 0.9,
          retrievedAt: new Date().toISOString(),
        });
      }

      // Check for diabetes complications
      const diabetesPatterns = ['excessive thirst', 'frequent urination.*excessive', 
        'diabetic.*ketoacidosis', 'dka', 'fruity breath'];
      if (matchesAny(symptoms, diabetesPatterns) || matchesAny(patientContext, ['diabetes', 'diabetic'])) {
        relevantContext.push({
          sourceId: 'africa-cdc',
          content: 'Diabetes mellitus is highly prevalent in SA. ' +
            'Non-communicable diseases are the leading cause of adult mortality. ' +
            'Consider DKA in patients with uncontrolled diabetes presenting with nausea/vomiting.',
          citation: 'Africa CDC / WHO AFRO - NCD Epidemiological Data',
          confidence: 0.9,
          retrievedAt: new Date().toISOString(),
        });
      }

      // Check for hypertension
      const htPatterns = ['severe hypertension', 'headache.*blurred vision', 'hypertensive crisis'];
      if (matchesAny(symptoms, htPatterns) || matchesAny(patientContext, ['hypertension', 'high blood pressure'])) {
        relevantContext.push({
          sourceId: 'africa-cdc',
          content: 'Hypertension is highly prevalent in SA and is a leading cause of cardiovascular mortality. ' +
            'Hypertensive crisis (BP >= 220/130) requires immediate emergency care. ' +
            'Consider secondary causes in resistant hypertension.',
          citation: 'Africa CDC / WHO AFRO - Cardiovascular Disease Data',
          confidence: 0.9,
          retrievedAt: new Date().toISOString(),
        });
      }

      // Always include general SA context
      relevantContext.push({
        sourceId: 'africa-cdc',
        content: 'South African epidemiological context: TB endemic, HIV prevalence ~13%, ' +
          'high NCD burden (hypertension, diabetes, CVD), malaria in Limpopo/KwaZulu-Natal. ' +
          'Rheumatic heart disease prevalent due to untreated streptococcal pharyngitis. ' +
          'Community-acquired pneumonia frequently caused by S. pneumoniae, TB, or P. jirovecii.',
        citation: 'Africa CDC / WHO AFRO - SA Disease Burden Summary',
        confidence: 1.0,
        retrievedAt: new Date().toISOString(),
      });

      return relevantContext;
    },

    async healthCheck(): Promise<boolean> {
      // This provider uses static data, so it's always healthy
      return true;
    },
  };
}

/**
 * Check if any pattern matches the input
 */
function matchesAny(input: string, patterns: string[]): boolean {
  const lowerInput = input.toLowerCase();
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(lowerInput)) {
      return true;
    }
  }
  return false;
}
