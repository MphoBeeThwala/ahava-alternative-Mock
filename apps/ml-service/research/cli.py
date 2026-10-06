"""
python -m research <command>

  readiness            how much data, which targets can be trained/validated yet
  triage               AI-vs-doctor triage agreement
  train --target T     train a CANDIDATE model + model card
  models               list models and their status
  approve N V --by X   allow a candidate to be scored in SHADOW (silent) mode
  revoke N V           withdraw that permission
  synthetic-export DIR write generated CSVs, to try the pipeline without patient data

Data source (readiness/triage/train): --source db (default; RESEARCH_DATABASE_URL, read-only login),
--source csv --csv-dir DIR, or --source synthetic (pipeline test; everything produced is flagged).
"""
import argparse
import json
import sys
from pathlib import Path

from . import registry
from .outcomes import TARGETS


def _load(args):
    from . import dataset, synthetic
    if args.source == "synthetic":
        s, o = synthetic.make_synthetic(n_subjects=args.synthetic_subjects, seed=args.seed)
        return s, o, True, {"source": "synthetic"}
    if args.source == "csv":
        if not args.csv_dir:
            sys.exit("--csv-dir is required with --source csv")
        s, o = dataset.load_from_csv(args.csv_dir)
        return s, o, False, {"source": "csv", "dir": args.csv_dir}
    s, o = dataset.load_from_db()
    return s, o, False, {"source": "database"}


def _add_source(p):
    p.add_argument("--source", choices=["db", "csv", "synthetic"], default="db")
    p.add_argument("--csv-dir")
    p.add_argument("--synthetic-subjects", type=int, default=600)
    p.add_argument("--seed", type=int, default=0)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="research", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("readiness"); _add_source(p); p.add_argument("--json", action="store_true")
    p = sub.add_parser("triage"); _add_source(p); p.add_argument("--json", action="store_true")
    p = sub.add_parser("train"); _add_source(p)
    p.add_argument("--target", required=True, choices=sorted(TARGETS))
    p.add_argument("--force-small", action="store_true", help="train a flagged, underpowered model despite too few events")
    p.add_argument("--bootstrap", type=int, default=300)
    sub.add_parser("models")
    p = sub.add_parser("approve"); p.add_argument("name"); p.add_argument("version"); p.add_argument("--by", required=True); p.add_argument("--note", default="")
    p = sub.add_parser("revoke"); p.add_argument("name"); p.add_argument("version")
    p = sub.add_parser("synthetic-export"); p.add_argument("out_dir"); p.add_argument("--subjects", type=int, default=600); p.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    if args.cmd == "models":
        for m in registry.list_models():
            print(json.dumps(m))
        return 0
    if args.cmd == "approve":
        try:
            rec = registry.approve(args.name, args.version, args.by, args.note)
        except (ValueError, FileNotFoundError) as e:
            print(f"not approved: {e}", file=sys.stderr)
            return 2
        print(f"Approved for SHADOW scoring only: {rec['name']} {rec['version']} by {rec['approved_by']} at {rec['approved_at']}")
        print("This does not validate the model and does not permit showing its output to anyone.")
        return 0
    if args.cmd == "revoke":
        print("revoked" if registry.revoke(args.name, args.version) else "no approval to revoke")
        return 0
    if args.cmd == "synthetic-export":
        from . import synthetic
        import pandas as pd
        s, o = synthetic.make_synthetic(n_subjects=args.subjects, seed=args.seed)
        d = Path(args.out_dir); d.mkdir(parents=True, exist_ok=True)
        s.to_csv(d / "snapshots.csv", index=False)
        o.assign(details=o["details"].map(json.dumps)).to_csv(d / "outcomes.csv", index=False)
        print(f"wrote SYNTHETIC data to {d}")
        return 0

    snaps, outs, synthetic_flag, provenance = _load(args)
    if args.cmd == "readiness":
        from .readiness import readiness_report, readiness_text
        rep = readiness_report(snaps, outs)
        print(json.dumps(rep, indent=2, default=str) if args.json else readiness_text(rep))
        if synthetic_flag:
            print("\n(SYNTHETIC data: pipeline demonstration only)")
        return 0
    if args.cmd == "triage":
        from .triage_agreement import agreement_report, agreement_text
        rep = agreement_report(outs)
        print(json.dumps(rep, indent=2, default=str) if args.json else agreement_text(rep))
        return 0
    if args.cmd == "train":
        from .dataset import build_frame
        from .outcomes import get_target
        from .train import card_markdown, train
        target = get_target(args.target)
        frame = build_frame(snaps, outs, target)
        try:
            art, card = train(frame, target, synthetic=synthetic_flag, seed=args.seed, n_boot=args.bootstrap,
                              force_small=args.force_small, data_provenance=provenance)
        except ValueError as e:
            print(f"not trained: {e}", file=sys.stderr)
            return 2
        d = registry.save_candidate(art)
        (d / "model_card.md").write_text(card_markdown(card))
        print(card_markdown(card))
        print(f"Saved CANDIDATE to {d}\nNot approved. Approval is a separate human step: python -m research approve {art.name} {art.version} --by '<name>'")
        return 0
    return 1
