import logging
import base64
from typing import Any
import httpx
from app.domain.models import ModelMetadata
from .base import BaseLLMGateway, http_client

class AnthropicGateway(BaseLLMGateway):
    """Anthropic Claude API Gateway."""

    def __init__(self, api_key: str) -> None:
        super().__init__()
        self.api_key = api_key

    async def generate(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        response_json: bool = False,
    ) -> str:
        if not self.api_key:
            raise RuntimeError("ANTHROPIC_API_KEY environment variable is not configured.")
        
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        }

        user_content = []
        if image_bytes and mime_type:
            b64_data = base64.b64encode(image_bytes).decode("utf-8")
            user_content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime_type,
                    "data": b64_data
                }
            })
        user_content.append({"type": "text", "text": prompt})

        payload: dict[str, Any] = {
            "model": metadata.id,
            "max_tokens": metadata.maxTokens or 4096,
            "messages": [{"role": "user", "content": user_content}],
            "temperature": 0.0
        }

        if system_instruction:
            payload["system"] = system_instruction

        if metadata.supportsThinking:
            payload["thinking"] = {"type": "enabled", "budget_tokens": 2048}
            payload["max_tokens"] = 8192
            payload["temperature"] = 1.0

        response = await http_client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        res_data = response.json()
        return res_data["content"][0]["text"] or ""
