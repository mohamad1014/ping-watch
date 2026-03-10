import os
import subprocess
from pathlib import Path


def test_ci_workflow_runs_repo_gates_and_rollback_validation():
    repo_root = Path(__file__).resolve().parents[2]
    workflow = repo_root / ".github" / "workflows" / "ci.yml"
    content = workflow.read_text()

    assert "./scripts/check-docs-consistency" in content
    assert "./scripts/check-migrations" in content
    assert "./scripts/staging-rollback-drill" in content
    assert "./scripts/test-unit" in content
    assert "./scripts/test-integration" in content
    assert "./scripts/test-e2e" in content


def test_check_migrations_script_uses_isolated_database():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "check-migrations"
    content = script.read_text()

    assert "#!/usr/bin/env bash" in content
    assert "mktemp" in content
    assert 'DATABASE_URL="${DATABASE_URL:-sqlite:///' in content
    assert ".venv/bin/alembic upgrade head" in content
    assert ".venv/bin/alembic current" in content
    assert "trap cleanup EXIT" in content


def test_check_migrations_script_passes_against_fresh_sqlite_database():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "check-migrations"

    result = subprocess.run(
        [str(script)],
        cwd=repo_root,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "migration check passed" in result.stdout


def test_staging_rollback_drill_script_reapplies_head_after_downgrade():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "staging-rollback-drill"
    content = script.read_text()

    assert "#!/usr/bin/env bash" in content
    assert "Rollback drill" in content
    assert 'DATABASE_URL="${DATABASE_URL:-sqlite:///' in content
    assert "python3 -" in content
    assert "resolve_downgrade_target" in content
    assert ".venv/bin/alembic upgrade head" in content
    assert '.venv/bin/alembic downgrade "$rollback_target"' in content
    assert ".venv/bin/alembic current" in content


def test_staging_rollback_drill_passes_against_fresh_sqlite_database():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "staging-rollback-drill"

    result = subprocess.run(
        [str(script)],
        cwd=repo_root,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "rollback drill passed" in result.stdout


def test_docs_cover_ci_and_rollback_scripts():
    repo_root = Path(__file__).resolve().parents[2]
    readme = (repo_root / "README.md").read_text()
    infra_readme = (repo_root / "infra" / "README.md").read_text()

    assert "./scripts/check-migrations" in readme
    assert "./scripts/staging-rollback-drill" in readme
    assert "DATABASE_URL" in readme
    assert "../scripts/staging-rollback-drill" in infra_readme
