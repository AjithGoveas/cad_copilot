import logging
from pathlib import Path
import httpx
from app.domain.models import ModelMetadata

# Setup logs directory
LOG_DIR = Path(__file__).resolve().parents[3] / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

llm_logger = logging.getLogger("llm_generator")
llm_logger.setLevel(logging.INFO)

if not llm_logger.handlers:
    file_handler = logging.FileHandler(LOG_DIR / "llm_generator.log", encoding="utf-8")
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s]: %(message)s")
    file_handler.setFormatter(formatter)
    llm_logger.addHandler(file_handler)

logger = llm_logger

# Global thread-safe connection pool with explicit limits
http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(90.0, connect=10.0),
    limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
)

class BaseLLMGateway:
    """Base class for all vendor-specific LLM gateways."""

    def __init__(self) -> None:
        self.logger = llm_logger

    async def generate(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        response_json: bool = False,
    ) -> str:
        raise NotImplementedError("Subclasses must implement generate")
