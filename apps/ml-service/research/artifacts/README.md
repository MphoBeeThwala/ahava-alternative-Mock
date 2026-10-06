# Model artifacts

Trained candidates land here (`<name>/<version>/model.json`, `model_card.md`).
**Everything in this directory is git-ignored by default**, so a candidate, and
above all a model trained on synthetic data, cannot be committed by accident.

A model reaches the live service only through a deliberate, reviewed commit:

1. Train offline (`python -m research train --target ...`), read the model card.
2. A named clinical lead approves it for **shadow scoring only**:
   `python -m research approve <name> <version> --by "<full name>" --note "<why>"`
   (writes `approval.json`, bound to the model's content hash; refuses synthetic models).
3. Add that one directory with `git add -f` and open a pull request. The
   approval is then a reviewed, versioned, attributable change. Editing
   `model.json` afterwards voids the approval automatically.
4. Deploy. The ML service re-reads approved models every minute; revoking
   (`python -m research revoke ...`, commit, deploy) stops scoring.

"Approved for shadow" means the model's predictions are stored silently beside
what later happened. It does not mean validated, and it does not permit showing
a prediction to any patient or clinician. See docs/RESEARCH_DATA_PIPELINE.md.
