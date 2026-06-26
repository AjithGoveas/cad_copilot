import logging
import base64
import httpx
from typing import Any
from app.domain.models import ModelMetadata
from .base import BaseLLMGateway, http_client

def _extract_text_from_json(data: Any) -> str:
    if not data:
        return ""
    
    # 1. Check steps format (modern interactions schema)
    if isinstance(data, dict) and "steps" in data:
        steps = data["steps"]
        if isinstance(steps, list):
            text_parts = []
            for step in steps:
                if isinstance(step, dict):
                    content = step.get("content", [])
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and "text" in item:
                                text_parts.append(item["text"])
                    elif isinstance(content, dict) and "text" in content:
                        text_parts.append(content["text"])
            if text_parts:
                return "".join(text_parts)

    # 2. Check outputs format (older/alternative interactions schema)
    if isinstance(data, dict) and "outputs" in data:
        outputs = data["outputs"]
        if isinstance(outputs, list):
            return "".join(out.get("text", "") for out in outputs if isinstance(out, dict))

    # 3. Fallback: Recursive search for "text" key anywhere in the structure
    texts = []
    def rec_search(obj: Any):
        if isinstance(obj, dict):
            if "text" in obj and isinstance(obj["text"], str):
                texts.append(obj["text"])
            for val in obj.values():
                rec_search(val)
        elif isinstance(obj, list):
            for val in obj:
                rec_search(val)
    
    rec_search(data)
    if texts:
        return "".join(texts)
        
    return ""

class GoogleGateway(BaseLLMGateway):
    """Google Gemini Interactions API gateway."""

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
            raise RuntimeError("GOOGLE_API_KEY environment variable is not configured.")
        
        url = "https://generativelanguage.googleapis.com/v1beta/interactions"
        headers = {
            "x-goog-api-key": self.api_key,
            "Content-Type": "application/json"
        }

        if image_bytes and mime_type:
            input_payload = [
                {
                    "type": "image",
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": base64.b64encode(image_bytes).decode("utf-8")
                    }
                },
                {
                    "type": "text",
                    "text": prompt
                }
            ]
        else:
            input_payload = prompt

        generation_config: dict[str, Any] = {
            "temperature": 0.0,
        }
        if response_json:
            generation_config["response_mime_type"] = "application/json"
        
        if metadata.maxTokens:
            generation_config["max_output_tokens"] = metadata.maxTokens

        if metadata.supportsThinking:
            generation_config["thinking_config"] = {
                "thinking_budget": 2048
            }

        payload = {
            "model": metadata.id,
            "input": input_payload,
            "generation_config": generation_config
        }

        if system_instruction:
            payload["system_instruction"] = system_instruction

        try:
            response = await http_client.post(url, headers=headers, json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            err_detail = f"Interactions API error (status={exc.response.status_code}): {exc.response.text}"
            self.logger.error(f"[Google Interactions HTTP Error] {err_detail}")
            raise RuntimeError(err_detail) from exc
        
        res_data = response.json()
        try:
            extracted = _extract_text_from_json(res_data)
            if not extracted:
                raise ValueError("No text output found in response.")
            return extracted
        except Exception as e:
            raise RuntimeError(f"Unexpected response structure from Google Interactions API: {res_data}") from e
