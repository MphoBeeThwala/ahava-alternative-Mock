import fs from 'fs';
import { PACKET_PATH, renderPacket } from './clinicalReviewPacket';

// A clinician's signature on the review packet only means something if the
// packet describes the code that is deployed. Any change to the TEWS chart,
// emergency-sign patterns, SpO2/ML thresholds, or scoring logic changes the
// generated packet and fails this test until it is regenerated (and, if the
// change touches a signed section, re-reviewed).
describe('clinical review packet', () => {
  it('matches the code it describes', () => {
    const committed = fs.readFileSync(PACKET_PATH, 'utf8');
    if (committed !== renderPacket()) {
      throw new Error(
        'docs/clinical-review/TRIAGE_SAFETY_REVIEW_PACKET.md is out of date with the triage code.\n' +
          'Run: pnpm --filter @ahava-healthcare/api clinical-review:packet — and if a signed section\n' +
          'changed, it needs clinician re-review before deploy.',
      );
    }
  });
});
