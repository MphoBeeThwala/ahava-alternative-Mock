// Barrel: re-exports every domain module so `import { x } from '@/lib/api'`
// (or a relative equivalent) keeps working exactly as it did when this was
// one 921-line file. Split by domain for maintainability only — no behavior
// change. Add new endpoints to the matching domain file, not here.
export * from './client';
export * from './auth';
export * from './patient';
export * from './bookings';
export * from './visits';
export * from './nurse';
export * from './doctor';
export * from './wearables';
export * from './consent';
export * from './admin';
export * from './doctorProfile';

export { default } from './client';
