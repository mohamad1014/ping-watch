from pathlib import Path


def test_deploy_vps_environment_script_supports_all_targets_and_syncs_env():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "deploy-vps-environment"
    content = script.read_text()

    assert 'environment_name=${1:?usage: deploy-vps-environment <dev|staging|production>}' in content
    assert 'case "$environment_name" in' in content
    assert 'env_source="$repo_root/dev.env"' in content
    assert 'env_source="$repo_root/staging.env"' in content
    assert 'env_source="$repo_root/production.env"' in content
    assert 'remote_env_path="/etc/ping-watch/${environment_name}.env"' in content
    assert 'redis-cli -h 127.0.0.1 ping' in content
    assert 'systemctl is-enabled nginx' in content
    assert 'systemctl is-enabled redis-server' in content
    assert 'nginx -t' in content
    assert 'rsync -az --delete' in content
    assert 'frontend/dist/' in content
    assert 'PING_WATCH_SERVER_ROOT=' in content
    assert "./scripts/deploy-vps-release '$environment_name'" in content


def test_deploy_vps_environment_script_maps_paths_and_ports_per_environment():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "deploy-vps-environment"
    content = script.read_text()

    assert 'frontend_base_path="/ping-watch-dev/"' in content
    assert 'api_path="/ping-watch-api-dev"' in content
    assert 'backend_port="8002"' in content
    assert 'frontend_base_path="/ping-watch-staging/"' in content
    assert 'api_path="/ping-watch-api-staging"' in content
    assert 'backend_port="8001"' in content
    assert 'frontend_base_path="/ping-watch/"' in content
    assert 'api_path="/ping-watch-api"' in content
    assert 'backend_port="8000"' in content


def test_deploy_vps_environment_defaults_to_https_domain_origin():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "deploy-vps-environment"
    content = script.read_text()

    assert 'public_origin=${PING_WATCH_PUBLIC_ORIGIN:-https://alhajj.nl}' in content


def test_deploy_vps_environment_script_passes_frontend_auth_flags_from_env_file():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "deploy-vps-environment"
    content = script.read_text()

    assert 'frontend_auth_required=$(read_env_value "$env_source" "AUTH_REQUIRED")' in content
    assert 'frontend_auth_auto_login=$(read_env_value "$env_source" "AUTH_DEV_LOGIN_ENABLED")' in content
    assert './scripts/build-frontend-static "$frontend_base_path" "$api_url" "" "$frontend_auth_required" "$frontend_auth_auto_login"' in content


def test_environment_wrapper_scripts_delegate_to_generic_script():
    repo_root = Path(__file__).resolve().parents[2]

    for environment_name in ("dev", "staging", "production"):
        script = repo_root / "scripts" / f"deploy-vps-{environment_name}"
        content = script.read_text()
        assert 'exec "$scripts_dir/deploy-vps-environment"' in content
        assert f'"{environment_name}" "$@"' in content


def test_build_frontend_static_script_accepts_auth_flags():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "build-frontend-static"
    content = script.read_text()

    assert 'auth_required=${4:-${VITE_AUTH_REQUIRED:-}}' in content
    assert 'auth_auto_login=${5:-${VITE_AUTH_AUTO_LOGIN:-}}' in content
    assert 'VITE_AUTH_REQUIRED="$auth_required"' in content
    assert 'VITE_AUTH_AUTO_LOGIN="$auth_auto_login"' in content


def test_staging_environment_uses_absolute_public_ping_watch_url():
    repo_root = Path(__file__).resolve().parents[2]
    env_file = repo_root / "staging.env"
    content = env_file.read_text()

    assert "PING_WATCH_PUBLIC_URL=https://alhajj.nl/ping-watch-staging/" in content


def test_deploy_vps_release_script_loads_environment_file_before_migrations():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "deploy-vps-release"
    content = script.read_text()

    assert 'environment_name=${1:?usage: deploy-vps-release <environment>}' in content
    assert 'env_file="/etc/ping-watch/${environment_name}.env"' in content
    assert 'set -a' in content
    assert '. "$env_file"' in content
    assert '.venv/bin/alembic upgrade head' in content


def test_nginx_snippet_preserves_query_strings_and_supports_all_paths():
    repo_root = Path(__file__).resolve().parents[2]
    snippet = repo_root / "infra" / "vps" / "nginx" / "ping-watch.locations.conf.template"
    content = snippet.read_text()

    assert 'return 308 /ping-watch-dev/$is_args$args;' in content
    assert 'return 308 /ping-watch/$is_args$args;' in content
    assert 'return 308 /ping-watch-staging/$is_args$args;' in content
    assert 'return 308 /ping-watch-api-dev/$is_args$args;' in content
    assert 'return 308 /ping-watch-api/$is_args$args;' in content
    assert 'return 308 /ping-watch-api-staging/$is_args$args;' in content
    assert 'proxy_pass http://127.0.0.1:8002/;' in content


def test_deploy_workflow_supports_dev_staging_and_production():
    repo_root = Path(__file__).resolve().parents[2]
    workflow = repo_root / ".github" / "workflows" / "deploy.yml"
    content = workflow.read_text()

    assert "- dev" in content
    assert "- staging" in content
    assert "- production" in content
    assert 'frontend_base_path="/ping-watch-dev/"' in content
    assert 'api_path="/ping-watch-api-dev"' in content
    assert "./scripts/deploy-vps-environment '${{ inputs.environment }}'" in content
