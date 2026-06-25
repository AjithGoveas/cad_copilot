from __future__ import annotations
import uuid
from datetime import datetime
from app.domain.models import ModelMetadata, HistoryItem
from app.domain.interfaces import ISessionRepository, ILLMProviderGateway
from .base_use_case import UseCaseBase
from .generate_cad_use_case import GenerateCadUseCase

REPAIR_SYSTEM_PROMPT = """
# ROLE: OpenSCAD Compiler Error Recovery Specialist
You are receiving an OpenSCAD script that failed to compile. Fix the EXACT error reported and return a corrected script.

## RULES
1. Return the COMPLETE corrected script — no snippets.
2. Fix ONLY what the error message describes. Minimal diff.
3. Common error patterns:
   - CGAL Geometry Engine Crash/non-manifold -> Add eps=0.02 to all difference() subtractive volumes.
   - orient=X/Y/Z -> change to orient=[1,0,0] / orient=[0,1,0] / orient=[0,0,1].
""".strip()

class RepairCadUseCase(UseCaseBase):
    """Interactor executing automated syntax self-healing on failing OpenSCAD compilations."""
    
    def __init__(self, llm_gateway: ILLMProviderGateway, session_repo: ISessionRepository) -> None:
        self.llm_gateway = llm_gateway
        self.session_repo = session_repo

    async def execute(
        self,
        code: str,
        error_message: str,
        primary_metadata: ModelMetadata,
        fallback_metadata: ModelMetadata | None = None,
        session_id: str | None = None,
    ) -> str:
        user_text = f"COMPILER_ERROR:\n{error_message}\n\nBROKEN_CODE:\n{code}"

        fallback_interactor = GenerateCadUseCase(self.llm_gateway, self.session_repo)
        raw_code = await fallback_interactor._execute_with_fallback(
            prompt=user_text,
            primary_metadata=primary_metadata,
            fallback_metadata=fallback_metadata,
            system_instruction=REPAIR_SYSTEM_PROMPT,
            response_json=False,
        )

        script = self._normalize_script(raw_code)
        final_script = self._validate_and_repair(script)

        if session_id:
            history_item = HistoryItem(
                id=str(uuid.uuid4()),
                sessionId=session_id,
                actionType="EDIT",
                prompt=f"WASM Self-Correction: {error_message[:100]}...",
                openscadCode=final_script,
                isFullSnapshot=False,
                createdAt=datetime.utcnow()
            )
            await self.session_repo.append_history_item(session_id, history_item)

        return final_script
