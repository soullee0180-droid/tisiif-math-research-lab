from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "contracts").exists():
    ROOT = Path("/app")

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: str = "production"
    app_origin: str = "http://localhost:8000"
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_server_secret: str = ""
    supabase_jwt_issuer: str = ""
    database_url: str = ""
    secrets_master_key: str = ""
    bootstrap_admin_email: str = ""
    team_email_allowlist: str = ""
    default_workspace_id: str = ""
    build_sha: str = ""
    worker_name: str = "worker-1"
    backup_dir: str = "/var/backups/tisiif"
    port: int = 8000
    local_storage_dir: str = ""
    test_auth_secret: str = ""

    def check(self):
        required = ["database_url", "supabase_url", "supabase_server_secret",
                    "secrets_master_key", "default_workspace_id"]
        result = {name: bool(getattr(self, name)) for name in required}
        if self.app_env == "production":
            result["https_origin"] = self.app_origin.startswith("https://")
            result["test_auth_disabled"] = not self.test_auth_secret
            result["local_storage_disabled"] = not self.local_storage_dir
        return result

@lru_cache
def settings():
    return Settings()

