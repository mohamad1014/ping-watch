from pathlib import Path


def test_deploy_vps_dev_script_checks_prerequisites_and_syncs_env():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "deploy-vps-dev"
    content = script.read_text()

    assert 'reject_placeholder_env_values "$staging_env_source"' in content
    assert 'staging_env_source="$repo_root/staging.env"' in content
    assert 'remote_env_path="/etc/ping-watch/staging.env"' in content
    assert 'redis-cli -h 127.0.0.1 ping' in content
    assert 'systemctl is-enabled nginx' in content
    assert 'systemctl is-enabled redis-server' in content
    assert 'nginx -t' in content
    assert 'rsync -az --delete' in content
    assert 'frontend/dist/' in content
    assert "PING_WATCH_SERVER_ROOT='/var/www/ping-watch' ./scripts/deploy-vps-release 'staging'" in content
    assert "curl -I http://127.0.0.1:8001/docs" in content
    assert "curl -I http://127.0.0.1/ping-watch-staging" in content


def test_deploy_vps_dev_script_builds_path_based_frontend():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "deploy-vps-dev"
    content = script.read_text()

    assert 'frontend_base_path="/ping-watch-staging/"' in content
    assert 'api_url="${public_origin}/ping-watch-api-staging"' in content
    assert './scripts/build-frontend-static "$frontend_base_path" "$api_url"' in content


def test_deploy_vps_dev_script_passes_frontend_auth_flags_from_staging_env():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "deploy-vps-dev"
    content = script.read_text()

    assert 'frontend_auth_required=$(read_env_value "$staging_env_source" "AUTH_REQUIRED")' in content
    assert 'frontend_auth_auto_login=$(read_env_value "$staging_env_source" "AUTH_DEV_LOGIN_ENABLED")' in content
    assert './scripts/build-frontend-static "$frontend_base_path" "$api_url" "" "$frontend_auth_required" "$frontend_auth_auto_login"' in content


def test_build_frontend_static_script_accepts_auth_flags():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "build-frontend-static"
    content = script.read_text()

    assert 'auth_required=${4:-${VITE_AUTH_REQUIRED:-}}' in content
    assert 'auth_auto_login=${5:-${VITE_AUTH_AUTO_LOGIN:-}}' in content
    assert 'VITE_AUTH_REQUIRED="$auth_required"' in content
    assert 'VITE_AUTH_AUTO_LOGIN="$auth_auto_login"' in content


def test_deploy_vps_release_script_loads_environment_file_before_migrations():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "deploy-vps-release"
    content = script.read_text()

    assert 'env_file="/etc/ping-watch/${environment_name}.env"' in content
    assert 'set -a' in content
    assert '. "$env_file"' in content
    assert '.venv/bin/alembic upgrade head' in content


def test_nginx_snippet_preserves_query_strings_on_path_redirects():
    repo_root = Path(__file__).resolve().parents[2]
    snippet = repo_root / "infra" / "vps" / "nginx" / "ping-watch.locations.conf.template"
    content = snippet.read_text()

    assert 'return 308 /ping-watch/$is_args$args;' in content
    assert 'return 308 /ping-watch-staging/$is_args$args;' in content
    assert 'return 308 /ping-watch-api/$is_args$args;' in content
    assert 'return 308 /ping-watch-api-staging/$is_args$args;' in content
