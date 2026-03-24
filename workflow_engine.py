"""Workflow validation and execution planning helpers for Zimmer."""

from __future__ import annotations

import re
from collections import deque
from typing import Any

_ALLOWED_NODE_TYPES = {"prompt", "skill"}
_NODE_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


class WorkflowValidationError(Exception):
    def __init__(self, issues: list[str]):
        super().__init__("invalid workflow definition")
        self.issues = issues


def skill_command_key(name: str) -> str:
    key = (name or "").strip().lower().replace(" ", "-").replace("_", "-")
    key = re.sub(r"[^a-z0-9-]", "", key)
    return key


def _as_graph(workflow: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    graph = workflow.get("graph") if isinstance(workflow.get("graph"), dict) else {}
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
    edges = graph.get("edges") if isinstance(graph.get("edges"), list) else []
    clean_nodes = [n for n in nodes if isinstance(n, dict)]
    clean_edges = [e for e in edges if isinstance(e, dict)]
    return clean_nodes, clean_edges


def validate_workflow(
    workflow: dict[str, Any],
    configured_skill_names: set[str] | None = None,
    allow_incomplete: bool = False,
) -> dict[str, Any]:
    issues: list[str] = []
    nodes, edges = _as_graph(workflow)

    node_ids: list[str] = []
    node_map: dict[str, dict[str, Any]] = {}
    for i, node in enumerate(nodes):
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            issues.append(f"node[{i}] is missing id")
            continue
        if not _NODE_ID_RE.match(node_id):
            issues.append(f"node[{i}] has invalid id '{node_id}'")
            continue
        if node_id in node_map:
            issues.append(f"duplicate node id '{node_id}'")
            continue

        node_type = str(node.get("type") or "").strip().lower()
        if node_type not in _ALLOWED_NODE_TYPES:
            issues.append(f"node '{node_id}' has unsupported type '{node_type}'")
        elif node_type == "prompt":
            prompt = str(node.get("prompt") or "").strip()
            if not prompt:
                issues.append(f"prompt node '{node_id}' is missing prompt")
        elif node_type == "skill":
            skill_name = str(node.get("skill") or node.get("label") or "").strip()
            if not skill_name:
                issues.append(f"skill node '{node_id}' is missing skill name")
            elif (
                configured_skill_names is not None
                and skill_name not in configured_skill_names
                and not allow_incomplete
            ):
                issues.append(f"skill node '{node_id}' references unavailable skill '{skill_name}'")

        node_ids.append(node_id)
        node_map[node_id] = node

    if not nodes and not allow_incomplete:
        issues.append("workflow graph has no nodes")

    normalized_edges: list[dict[str, str]] = []
    if edges:
        for i, edge in enumerate(edges):
            src = str(edge.get("from") or "").strip()
            dst = str(edge.get("to") or "").strip()
            if not src or not dst:
                issues.append(f"edge[{i}] must include 'from' and 'to'")
                continue
            if src not in node_map:
                issues.append(f"edge[{i}] source '{src}' does not exist")
                continue
            if dst not in node_map:
                issues.append(f"edge[{i}] target '{dst}' does not exist")
                continue
            if src == dst:
                issues.append(f"edge[{i}] forms self-loop on '{src}'")
                continue
            normalized_edges.append({"from": src, "to": dst})
    else:
        # Fallback to sequential order when explicit edges are absent.
        for i in range(len(node_ids) - 1):
            normalized_edges.append({"from": node_ids[i], "to": node_ids[i + 1]})

    if issues:
        raise WorkflowValidationError(issues)

    if not node_ids:
        return {
            "node_ids": [],
            "node_map": {},
            "edges": [],
            "order": [],
            "predecessors": {},
        }

    order, predecessors = topological_order(node_ids, normalized_edges)
    return {
        "node_ids": node_ids,
        "node_map": node_map,
        "edges": normalized_edges,
        "order": order,
        "predecessors": predecessors,
    }


def topological_order(node_ids: list[str], edges: list[dict[str, str]]) -> tuple[list[str], dict[str, list[str]]]:
    out_map: dict[str, list[str]] = {nid: [] for nid in node_ids}
    in_degree: dict[str, int] = {nid: 0 for nid in node_ids}
    predecessors: dict[str, list[str]] = {nid: [] for nid in node_ids}

    for e in edges:
        src = e["from"]
        dst = e["to"]
        out_map[src].append(dst)
        in_degree[dst] += 1
        predecessors[dst].append(src)

    q = deque(sorted([nid for nid in node_ids if in_degree[nid] == 0]))
    out: list[str] = []
    while q:
        cur = q.popleft()
        out.append(cur)
        for nxt in out_map[cur]:
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                q.append(nxt)

    if len(out) != len(node_ids):
        cycle_nodes = [nid for nid in node_ids if in_degree[nid] > 0]
        raise WorkflowValidationError([f"workflow graph has cycle(s): {', '.join(cycle_nodes)}"])

    return out, predecessors


def render_node_input(initial_input: str, predecessors: list[str], outputs: dict[str, str]) -> str:
    if not predecessors:
        return initial_input
    if len(predecessors) == 1:
        return outputs.get(predecessors[0], "")
    chunks = []
    for p in predecessors:
        chunks.append(f"[{p}]\n{outputs.get(p, '')}")
    return "\n\n".join(chunks)
