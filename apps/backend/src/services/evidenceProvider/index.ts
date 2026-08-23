/**
 * Evidence Provider Module
 * Central abstraction for all clinical evidence sources
 * 
 * Usage:
 *   import { combineEvidence, getProviderRegistry, isProviderEnabled } from './evidenceProvider';
 *   
 *   const combined = await combineEvidence({ symptoms: 'chest pain' });
 *   if (combined.hasSufficientEvidence) {
 *     const context = combined.results.map(r => r.content).join('\n');
 *   }
 */

export * from './types';
export * from './registry';
export * from './combiner';
export * from './providers/whoIcd11';
export * from './providers/pubmed';
export * from './providers/africaCdc';
export * from './providers/statPearls';
export * from './providers/infermedica';
export * from './providers/visualDx';
