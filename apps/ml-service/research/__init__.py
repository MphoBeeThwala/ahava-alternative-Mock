"""
Offline research pipeline: build datasets from the pseudonymised research
tables, train and evaluate candidate prediction models, report whether there
is enough data to seek validation, and (once a named human approves a model)
score new snapshots in shadow.

Nothing in this package changes a live decision. The live service imports only
`research.shadow`, which serves predictions that are stored and never shown.
Training and evaluation need scikit-learn (requirements-research.txt) and run
offline; the live service needs numpy only. See docs/RESEARCH_DATA_PIPELINE.md.
"""
