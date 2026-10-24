import copy
import hashlib
import json
import re
from collections import defaultdict
from lab.config import ROOT
from lab.db import serial

PROVIDERS = ("google", "openai", "anthropic")
METRICS = ("selected_usefulness", "best_usefulness", "selection_regret", "any_core_match", "selected_core_match")

def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=serial)

def digest(obj):
    return hashlib.sha256((obj if isinstance(obj, bytes) else canonical(obj).encode())).hexdigest()

def contract(path):
    return json.loads((ROOT / "contracts" / path).read_text())

def definition():
    return {**contract("research-protocol.json"),
        "prompts": {p: contract("prompts/" + p + ".json") for p in ("generate", "select", "usefulness", "agreement")},
        "schemas": {p: contract("schemas/" + p + ".schema.json") for p in ("generate", "select", "usefulness", "agreement")}}

def public_context(revision):
    return {"public_abstract": revision["abstract_md"],
        "public_stages": [{"index": s["index"], "title": s.get("title", ""), "body_md": s.get("body_md", "")}
                         for s in revision["stage_outline"] if s.get("is_public")],
        "public_text": revision["public_text_md"] if revision["input_mode"] == "text" else ""}

def input_snapshot(revision, prepared=None):
    return {"public_context": public_context(revision), "goal": revision["goal_md"],
        "obstacle": revision["obstacle_md"], "input_mode": revision["input_mode"],
        "prepared_asset_id": str(revision["prepared_asset_id"]) if revision.get("prepared_asset_id") else None,
        "prepared_sha256": prepared["sha256"] if prepared else None}

def input_hash(revision, prepared=None):
    return digest(input_snapshot(revision, prepared))

def schema_for(protocol, phase, k):
    s = copy.deepcopy(protocol["schemas"][phase])
    field = "ideas" if phase == "generate" else "ratings" if phase in ("usefulness", "agreement") else None
    if field:
        s["properties"][field]["minItems"] = k
        s["properties"][field]["maxItems"] = k
        item = s["properties"][field]["items"]["properties"]["candidate_id"]
        item["enum"] = [("I" if phase == "generate" else "C") + str(i) for i in range(1, k + 1)]
    else:
        s["properties"]["selected_candidate_id"]["enum"] = ["C" + str(i) for i in range(1, k + 1)]
    return s

def clean_identity(s):
    # Only standalone provider self-introductions; never replace mathematical prose substrings.
    return re.sub(r"(?im)^\s*As an (?:OpenAI|Anthropic|Google)[^\n]*\n?", "", s)

def assemble(run, phase, judge, frozen, ideas):
    protocol = frozen["protocol"]
    snap = frozen["inputs"][str(run["checkpoint_revision_id"])]
    k = run["candidate_count"]
    seed = hashlib.sha256((str(run["id"]) + ":" + phase + ":" + (judge or "")).encode()).hexdigest()
    order = sorted(ideas, key=lambda x: hashlib.sha256((seed + ":I" + str(x["ordinal"])).encode()).hexdigest())
    mapping = {"C" + str(i + 1): "I" + str(row["ordinal"]) for i, row in enumerate(order)}
    candidates = []
    for i, row in enumerate(order):
        candidates.append({"candidate_id": "C" + str(i + 1),
            **{f: clean_identity(row[f]) if isinstance(row[f], str) else row[f]
               for f in ("title", "idea_md", "why_helpful_md", "next_steps", "assumptions", "unverified_points")}})
    vars = {"PUBLIC_CONTEXT": canonical(snap["public_context"]),
            "TASK": "Goal:\n" + snap["goal"] + "\n\nCurrent obstacle:\n" + snap["obstacle"],
            "K": str(k), "CANDIDATES": canonical(candidates)}
    if phase == "agreement":
        vars["REFERENCE"] = frozen["references"][str(run["checkpoint_revision_id"])]
    prompt = protocol["prompts"][phase]
    user_text = prompt["user_template"]
    for name, val in vars.items():
        user_text = user_text.replace("{{" + name + "}}", val)
    if re.search(r"\{\{[A-Z_]+\}\}", user_text):
        raise ValueError("UNRESOLVED_TEMPLATE_VARIABLE")
    return {"stage": phase, "model_snapshot": run["generator_model"] if not judge else run["judge_models"][judge],
            "system_text": prompt["system"], "user_text": user_text,
            "response_schema": schema_for(protocol, phase, k),
            "prepared_pdf_asset_id": snap["prepared_asset_id"],
            "display_to_canonical": mapping, "input_hash": snap["hash"]}

def parse_output(text, phase, protocol, k):
    from jsonschema import validate
    raw = text.strip()
    if raw.startswith("```"):
        match = re.fullmatch(r"```(?:json)?\s*\n(.*?)\n```", raw, re.S)
        if not match: raise ValueError("INVALID_JSON_FENCE")
        raw = match.group(1)
    obj = json.loads(raw)
    validate(obj, schema_for(protocol, phase, k))
    if phase == "generate":
        rows = obj["ideas"]
        expected = {"I" + str(i) for i in range(1, k + 1)}
    elif phase in ("usefulness", "agreement"):
        rows = obj["ratings"]
        expected = {"C" + str(i) for i in range(1, k + 1)}
    else:
        return obj
    if len(rows) != k or {r["candidate_id"] for r in rows} != expected:
        raise ValueError("CANDIDATE_ID_SET_MISMATCH")
    for row in rows:
        for key, v in row.items():
            if isinstance(v, str) and key not in ("unable_reason",) and not v.strip():
                raise ValueError("EMPTY_REQUIRED_STRING")
        if phase == "usefulness":
            score = row["score"]
            if score is None:
                if not (row.get("unable_reason") or "").strip():
                    raise ValueError("INVALID_SCORE_OR_NULL_REASON")
            elif type(score) is not int or not 0 <= score <= 4:
                raise ValueError("SCORE_OUT_OF_RANGE")
        if phase == "agreement" and row["label"] == "undetermined" and not (row.get("unable_reason") or "").strip():
            raise ValueError("UNDETERMINED_WITHOUT_REASON")
    return obj

def metrics(ideas, selected):
    u, m, flags = {}, {}, []
    for row in ideas:
        ident = row.get("id", "I" + str(row.get("ordinal", "")))
        a = row.get("u", [])
        labels = row.get("match", [])
        u[ident] = sum(a) / 2 if len(a) == 2 and all(type(x) is int for x in a) else None
        m[ident] = int(all(x == "core" for x in labels)) if len(labels) == 2 and all(x in ("none", "partial", "core") for x in labels) else None
        if len(a) == 2 and all(type(x) is int for x in a) and abs(a[0] - a[1]) >= 2:
            flags.append(ident)
    su = u.get(selected)
    best = max(u.values()) if u and all(v is not None for v in u.values()) else None
    return {"selected_usefulness": su, "best_usefulness": best,
        "selection_regret": best - su if best is not None and su is not None else None,
        "any_core_match": int(any(m.values())) if m and all(v is not None for v in m.values()) else None,
        "selected_core_match": m.get(selected), "review_flags": flags}

def aggregate(rows, common=True):
    out = {p: {} for p in PROVIDERS}
    for metric in METRICS:
        usable = defaultdict(set)
        for row in rows:
            if row["metrics"][metric] is not None:
                usable[(str(row["checkpoint_revision_id"]), row["repeat_no"])].add(row["generator_provider"])
        eligible = {key for key, providers in usable.items() if not common or providers == set(PROVIDERS)}
        for provider in PROVIDERS:
            checkpoint = defaultdict(list)
            all_rows = [r for r in rows if r["generator_provider"] == provider]
            included = []
            for r in all_rows:
                key = (str(r["checkpoint_revision_id"]), r["repeat_no"])
                if key in eligible and r["metrics"][metric] is not None:
                    checkpoint[(str(r["paper_id"]), str(r["checkpoint_revision_id"]))].append(r["metrics"][metric])
                    included.append(str(r["id"]))
            papers = defaultdict(list)
            for (paper, _), values in checkpoint.items(): papers[paper].append(sum(values) / len(values))
            paper_values = [sum(v) / len(v) for v in papers.values()]
            out[provider][metric] = {"value": sum(paper_values) / len(paper_values) if paper_values else None,
                "eligible_runs": len(included), "total_runs": len(all_rows), "papers": len(papers),
                "checkpoints": len(checkpoint), "excluded_runs": len(all_rows) - len(included),
                "included_run_ids": included}
    return out

