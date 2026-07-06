import logging
import base64
from typing import Any
import httpx
from app.domain.models import ModelMetadata
from .base import BaseLLMGateway, http_client

class DeepSeekGateway(BaseLLMGateway):
    """DeepSeek API Gateway."""

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
            raise RuntimeError("DEEPSEEK_API_KEY environment variable is not configured.")
        
        url = "https://api.deepseek.com/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})

        user_content: list[dict[str, Any]] = []
        if image_bytes and mime_type:
            b64_data = base64.b64encode(image_bytes).decode("utf-8")
            user_content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime_type};base64,{b64_data}"
                }
            })
        user_content.append({"type": "text", "text": prompt})
        messages.append({"role": "user", "content": user_content})

        payload: dict[str, Any] = {
            "model": metadata.id,
            "messages": messages,
            "temperature": 0.0
        }

        if metadata.maxTokens:
            payload["max_tokens"] = metadata.maxTokens

        if response_json:
            payload["response_format"] = {"type": "json_object"}

        response = await http_client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        res_data = response.json()
        return res_data["choices"][0]["message"]["content"] or ""
