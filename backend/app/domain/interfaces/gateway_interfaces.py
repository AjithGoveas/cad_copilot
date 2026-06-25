from abc import ABC, abstractmethod
from app.domain.models import ModelMetadata

class ILLMProviderGateway(ABC):
    """Abstract gateway contract for executing vendor-agnostic LLM code-generation queries."""
    
    @abstractmethod
    async def generate_parametric_cad(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        response_json: bool = False,
    ) -> str:
        """Executes a non-blocking generation request against the designated LLM vendor endpoint."""
        pass
