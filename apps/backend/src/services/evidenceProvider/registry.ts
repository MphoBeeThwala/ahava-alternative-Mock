import { EvidenceProvider, EvidenceProviderConfig, EvidenceProviderRegistry, EvidenceTier } from './types';
import { whoIcd11Provider } from './providers/whoIcd11';
import { pubmedProvider } from './providers/pubmed';
import { africaCdcProvider } from './providers/africaCdc';
import { statPearlsProvider } from './providers/statPearls';
import { infermedicaProvider } from './providers/infermedica';
import { visualDxProvider } from './providers/visualDx';

// Default configurations for all providers
const DEFAULT_CONFIGS: Record<string, EvidenceProviderConfig> = {
  'who-icd11': {
    id: 'who-icd11',
    tier: 'structural',
    enabled: true, // Always enabled - structural normalization
    baseUrl: 'https://icd11rest.who.int',
    timeoutMs: 5000,
    weight: 1.0, // Structural sources have highest priority for normalization
  },
  'pubmed': {
    id: 'pubmed',
    tier: 'literature',
    enabled: true,
    baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
    timeoutMs: 10000,
    weight: 0.9, // High weight for peer-reviewed literature
  },
  'statpearls': {
    id: 'statpearls',
    tier: 'literature',
    enabled: true,
    baseUrl: 'https://www.ncbi.nlm.nih.gov',
    timeoutMs: 10000,
    weight: 0.8, // Slightly lower than PubMed due to HTML scraping fragility
  },
  'africa-cdc': {
    id: 'africa-cdc',
    tier: 'literature',
    enabled: true,
    timeoutMs: 5000,
    weight: 0.95, // High weight for SA-specific epidemiological context
  },
  'infermedica': {
    id: 'infermedica',
    tier: 'engine',
    enabled: false, // Disabled until commercial agreement in place
    baseUrl: 'https://api.infermedica.com/v3',
    timeoutMs: 10000,
    weight: 0.7, // Engine outputs are second opinions, not primary evidence
  },
  'visualdx': {
    id: 'visualdx',
    tier: 'image',
    enabled: false, // Disabled until funded
    baseUrl: 'https://api.visualdx.com/v1',
    timeoutMs: 15000,
    weight: 0.8,
  },
};

// Initialize the provider registry
function initializeProviderRegistry(): EvidenceProviderRegistry {
  const registry = new Map<string, EvidenceProvider>();
  
  // Register all providers
  registry.set('who-icd11', whoIcd11Provider(DEFAULT_CONFIGS['who-icd11']));
  registry.set('pubmed', pubmedProvider(DEFAULT_CONFIGS['pubmed']));
  registry.set('statpearls', statPearlsProvider(DEFAULT_CONFIGS['statpearls']));
  registry.set('africa-cdc', africaCdcProvider(DEFAULT_CONFIGS['africa-cdc']));
  registry.set('infermedica', infermedicaProvider(DEFAULT_CONFIGS['infermedica']));
  registry.set('visualdx', visualDxProvider(DEFAULT_CONFIGS['visualdx']));
  
  return registry;
}

// Singleton registry instance
let providerRegistry: EvidenceProviderRegistry | null = null;

export function getProviderRegistry(): EvidenceProviderRegistry {
  if (!providerRegistry) {
    providerRegistry = initializeProviderRegistry();
  }
  return providerRegistry;
}

// Get enabled providers filtered by tier
export function getEnabledProviders(tier?: EvidenceTier): EvidenceProvider[] {
  const registry = getProviderRegistry();
  const providers: EvidenceProvider[] = [];
  
  for (const provider of registry.values()) {
    if (provider.config.enabled && (!tier || provider.tier === tier)) {
      providers.push(provider);
    }
  }
  
  return providers;
}

// Get a specific provider by ID
export function getProvider(providerId: string): EvidenceProvider | undefined {
  const registry = getProviderRegistry();
  return registry.get(providerId);
}

// Check if a specific provider is enabled
export function isProviderEnabled(providerId: string): boolean {
  const provider = getProvider(providerId);
  return provider?.config.enabled ?? false;
}

// Update provider configuration (for runtime toggling)
export function updateProviderConfig(providerId: string, updates: Partial<EvidenceProviderConfig>): void {
  const provider = getProvider(providerId);
  if (provider) {
    provider.config = { ...provider.config, ...updates };
  }
}

// Reset registry (for testing)
export function resetProviderRegistry(): void {
  providerRegistry = null;
}
