from __future__ import annotations
import base64
import os
from typing import Any
import httpx
from app.domain.models import ModelMetadata
from app.domain.interfaces import ILLMProviderGateway

# Global thread-safe connection pool with explicit limits
_http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(90.0, connect=10.0),
    limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
)

class UniversalHTTPXGateway(ILLMProviderGateway):
    """Concrete implementation of the LLM provider gateway using raw HTTPX REST integrations."""
    
    def __init__(self) -> None:
        self.google_api_key = os.getenv("GOOGLE_API_KEY", "")
        self.deepseek_api_key = os.getenv("DEEPSEEK_API_KEY", "")
        self.anthropic_api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "")
        self.ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")

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

        if vendor == "google":
            if not self.google_api_key:
                raise RuntimeError("GOOGLE_API_KEY environment variable is not configured.")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{metadata.id}:generateContent?key={self.google_api_key}"
            headers = {"Content-Type": "application/json"}

            contents = []
            if image_bytes and mime_type:
                contents.append({
                    "inlineData": {
                        "mimeType": mime_type,
                        "data": base64.b64encode(image_bytes).decode("utf-8")
                    }
                })
            contents.append({
                "parts": [{"text": prompt}]
            })

            generation_config: dict[str, Any] = {
                "temperature": 0.0,
            }
            if response_json:
                generation_config["responseMimeType"] = "application/json"
            
            if metadata.maxTokens:
                generation_config["maxOutputTokens"] = metadata.maxTokens

            if metadata.supportsThinking:
                generation_config["thinkingConfig"] = {
                    "thinkingBudget": 2048
                }

            payload = {
                "contents": contents,
                "generationConfig": generation_config
            }
            if system_instruction:
                payload["systemInstruction"] = {
                    "parts": [{"text": system_instruction}]
                }

            response = await _http_client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            res_data = response.json()
            try:
                parts = res_data["candidates"][0]["content"]["parts"]
                return "".join(part.get("text", "") for part in parts)
            except (KeyError, IndexError):
                raise RuntimeError(f"Unexpected response structure from Google API: {res_data}")

        elif vendor == "openai":
            if not self.openai_api_key:
                raise RuntimeError("OPENAI_API_KEY environment variable is not configured.")
            url = "https://api.openai.com/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.openai_api_key}",
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
            }

            is_reasoning = metadata.supportsThinking or any(m in metadata.id.lower() for m in ["o1", "o3", "gpt-5"])
            if is_reasoning:
                payload["reasoning_effort"] = "high" if image_bytes else "medium"
                if metadata.maxTokens:
                    payload["max_completion_tokens"] = metadata.maxTokens
            else:
                payload["temperature"] = 0.0
                if metadata.maxTokens:
                    payload["max_tokens"] = metadata.maxTokens

            if response_json:
                payload["response_format"] = {"type": "json_object"}

            response = await _http_client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            res_data = response.json()
            return res_data["choices"][0]["message"]["content"] or ""

        elif vendor == "deepseek":
            if not self.deepseek_api_key:
                raise RuntimeError("DEEPSEEK_API_KEY environment variable is not configured.")
            url = "https://api.deepseek.com/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.deepseek_api_key}",
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

            response = await _http_client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            res_data = response.json()
            return res_data["choices"][0]["message"]["content"] or ""

        elif vendor == "anthropic":
            if not self.anthropic_api_key:
                raise RuntimeError("ANTHROPIC_API_KEY environment variable is not configured.")
            url = "https://api.anthropic.com/v1/messages"
            headers = {
                "x-api-key": self.anthropic_api_key,
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

            response = await _http_client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            res_data = response.json()
            return res_data["content"][0]["text"] or ""

        elif vendor == "ollama":
            url = f"{self.ollama_host}/api/chat"
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

            response = await _http_client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            res_data = response.json()
            return res_data["message"]["content"] or ""

        else:
            raise ValueError(f"Unsupported vendor: {vendor}")
