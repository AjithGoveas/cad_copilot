import logging
import base64
from typing import Any
import httpx
from app.domain.models import ModelMetadata
from .base import BaseLLMGateway, http_client

class OllamaGateway(BaseLLMGateway):
    """Local Ollama instance Gateway."""

    def __init__(self, host: str) -> None:
        super().__init__()
        self.host = host

    async def generate(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        response_json: bool = False,
    ) -> str:
        url = f"{self.host}/api/chat"
        headers = {"Content-Type": "application/json"}

        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})

        user_message: dict[str, Any] = {"role": "user", "content": prompt}
        if image_bytes and mime_type:
            b64_data = base64.b64encode(image_bytes).decode("utf-8")
            user_message["images"] = [b64_data]

        messages.append(user_message)

        payload = {
            "model": metadata.id,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.0
            }
        }

        if metadata.maxTokens:
            payload["options"]["num_predict"] = metadata.maxTokens

        response = await http_client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        res_data = response.json()
        return res_data["message"]["content"] or ""
