"""Tests for ontology loading and querying."""

from pathlib import Path

import pytest
import yaml

from ontology_rag import Ontology
from ontology_rag.ontology import AgentInfo


def test_load_agents(sample_ontology_dir):
    """Test that agents are loaded correctly."""
    onto = Ontology(sample_ontology_dir)
    assert len(onto.agents) == 3
    assert "lang-golang-expert" in onto.agents


def test_agent_info(sample_ontology_dir):
    """Test that agent information is parsed correctly."""
    onto = Ontology(sample_ontology_dir)
    agent = onto.get_agent("lang-golang-expert")
    assert agent is not None
    assert agent.model_lane == "frontier"
    assert agent.model_reasoning_effort == "high"
    assert agent.model == "sonnet"  # Deprecated v1.0.0 compatibility alias.
    assert agent.effort == "high"  # Deprecated v1.0.0 compatibility alias.
    assert "go-best-practices" in agent.skills


@pytest.mark.parametrize(
    ("model_lane", "deprecated_model"),
    [("inherit", "inherit"), ("frontier", "sonnet"), ("spark", "haiku")],
)
def test_agent_info_deprecated_model_alias(model_lane, deprecated_model):
    """Map canonical model lanes to stable v1.0.0 compatibility aliases."""
    agent = AgentInfo("agent", "SystemAgent", "test", model_lane)
    assert agent.model == deprecated_model


def test_legacy_agent_input_aliases(tmp_path):
    """Accept v1.0.0 input names while storing only canonical ontology state."""
    (tmp_path / "agents.yaml").write_text(
        """
agents:
  legacy:
    model: opus
    effort: high
"""
    )
    agent = Ontology(tmp_path).get_agent("legacy")
    assert agent is not None
    assert agent.model_lane == "frontier"
    assert agent.model_reasoning_effort == "high"
    assert agent.model == "sonnet"
    assert agent.effort == "high"


@pytest.mark.parametrize(
    "agent_fields",
    [
        "model: sonnet\n    model_lane: frontier",
        "effort: low\n    model_reasoning_effort: high",
    ],
)
def test_agent_input_alias_conflicts_fail_closed(tmp_path, agent_fields):
    """Reject ambiguous legacy/native metadata rather than guessing precedence."""
    (tmp_path / "agents.yaml").write_text(
        f"agents:\n  conflict:\n    {agent_fields}\n"
    )
    with pytest.raises(ValueError, match="conflict"):
        Ontology(tmp_path)


def test_v1_schema_documents_native_and_deprecated_agent_fields():
    """Keep schema 1.0.0 additive for native and existing consumers."""
    schema_path = (
        Path(__file__).resolve().parents[3]
        / "templates"
        / ".claude"
        / "ontology"
        / "schema.yaml"
    )
    schema = yaml.safe_load(schema_path.read_text())
    properties = schema["entity_types"]["Agent"]["properties"]

    assert schema["version"] == "1.0.0"
    assert properties["model_lane"]["required"] is False
    assert properties["model"]["deprecated"] is True
    assert properties["model"]["required"] is False
    assert properties["model"]["compatibility_alias_for"] == "model_lane"
    assert properties["model_reasoning_effort"]["required"] is False
    assert properties["effort"]["deprecated"] is True
    assert (
        properties["effort"]["compatibility_alias_for"]
        == "model_reasoning_effort"
    )


def test_agents_by_class(sample_ontology_dir):
    """Test querying agents by class."""
    onto = Ontology(sample_ontology_dir)
    experts = onto.get_agents_by_class("LanguageExpert")
    assert len(experts) == 2


def test_load_skills(sample_ontology_dir):
    """Test that skills are loaded correctly."""
    onto = Ontology(sample_ontology_dir)
    assert len(onto.skills) == 4
    skill = onto.get_skill("go-best-practices")
    assert skill is not None
    assert not skill.user_invocable


def test_load_rules(sample_ontology_dir):
    """Test that rules are loaded correctly."""
    onto = Ontology(sample_ontology_dir)
    assert len(onto.rules) == 3
    rule = onto.get_rule("R007")
    assert rule is not None
    assert rule.rule_class == "MustRule"


def test_rules_by_category(sample_ontology_dir):
    """Test querying rules by category."""
    onto = Ontology(sample_ontology_dir)
    rules = onto.get_rules_by_category("agent-design")
    assert len(rules) == 2


def test_search_by_keywords(sample_ontology_dir):
    """Test keyword search across entities."""
    onto = Ontology(sample_ontology_dir)
    results = onto.search_by_keywords(["golang", "go"])
    assert len(results) > 0
    assert results[0][1].name == "lang-golang-expert"


def test_get_agent_context(sample_ontology_dir):
    """Test getting complete agent context."""
    onto = Ontology(sample_ontology_dir)
    ctx = onto.get_agent_context("lang-golang-expert")
    assert "agent" in ctx
    assert ctx["agent"].name == "lang-golang-expert"
    assert len(ctx["skills"]) > 0
    assert len(ctx["rules"]) > 0


def test_nonexistent_agent(sample_ontology_dir):
    """Test querying nonexistent agent returns None."""
    onto = Ontology(sample_ontology_dir)
    agent = onto.get_agent("nonexistent-agent")
    assert agent is None


def test_empty_ontology_dir(tmp_path):
    """Test loading from empty directory doesn't crash."""
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    onto = Ontology(empty_dir)
    assert len(onto.agents) == 0
    assert len(onto.skills) == 0
    assert len(onto.rules) == 0
