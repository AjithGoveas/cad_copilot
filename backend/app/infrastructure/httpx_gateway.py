from __future__ import annotations
import os
from app.domain.models import ModelMetadata
from app.domain.interfaces import ILLMProviderGateway
from app.infrastructure.gateways.base import logger
from app.infrastructure.gateways import (
    GoogleGateway,
    OpenAIGateway,
    DeepSeekGateway,
    AnthropicGateway,
    OllamaGateway,
)

class UniversalHTTPXGateway(ILLMProviderGateway):
    """Concrete implementation of the LLM provider gateway delegating to sub-modularized vendor gateways."""
    
    def __init__(self) -> None:
        self.google_api_key = os.getenv("GOOGLE_API_KEY", "")
        self.deepseek_api_key = os.getenv("DEEPSEEK_API_KEY", "")
        self.anthropic_api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "")
        self.ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")

        # Instantiate sub-gateways
        self._gateways = {
            "google": GoogleGateway(self.google_api_key),
            "openai": OpenAIGateway(self.openai_api_key),
            "deepseek": DeepSeekGateway(self.deepseek_api_key),
            "anthropic": AnthropicGateway(self.anthropic_api_key),
            "ollama": OllamaGateway(self.ollama_host),
        }

    async def generate_parametric_cad(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        response_json: bool = False,
    ) -> str:
        vendor = metadata.vendor
        gateway = self._gateways.get(vendor)
        if not gateway:
            logger.error(f"Failed generation request: Unsupported vendor '{vendor}' requested.")
            raise ValueError(f"Unsupported vendor: {vendor}")
        
        logger.info(f"Initiated generation request to vendor '{vendor}' for model '{metadata.id}'")
        logger.info(f"Prompt: {prompt}")
        if image_bytes:
            logger.info(f"Multimodal image context attached: {mime_type} ({len(image_bytes)} bytes)")

        try:
            result = await gateway.generate(
                prompt=prompt,
                metadata=metadata,
                system_instruction=system_instruction,
                image_bytes=image_bytes,
                mime_type=mime_type,
                response_json=response_json,
            )
            logger.info(f"Successfully generated response from vendor '{vendor}' for model '{metadata.id}'")
            logger.info(f"Response: {result}")
            return result
        except Exception as exc:
            logger.error(f"Error generating response from vendor '{vendor}' for model '{metadata.id}': {exc}")
            raise

