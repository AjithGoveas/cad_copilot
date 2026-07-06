from __future__ import annotations
import uuid
from datetime import datetime
from app.domain.models import ModelMetadata, HistoryItem
from app.domain.interfaces import ISessionRepository, ILLMProviderGateway
from .base_use_case import UseCaseBase
from .generate_cad_use_case import GenerateCadUseCase

EDIT_SYSTEM_PROMPT = """
# ROLE: Expert CAD Revision Engineer & Code Refinement Agent

You are performing surgical geometric updates on an existing BOSL2-based OpenSCAD model.

## ⚠️ IMMUTABILITY & ENGINE RULES

1. **Never generate a completely new part from scratch**. Retain the foundational modules, structural identifiers, and base assets.
2. **Variable Protection**: You are strictly FORBIDDEN from altering the string spelling of any variable keys inside the `// PARAMETERS_START` envelope. You may append new parameter keys or adjust their default right-hand numbers, but changing key names will break the user's React slider system completely.
3. **Orientation Syntax Constraint**: Ensure all rotational adjustments use explicit direction vector arrays (e.g., `orient=[1,0,0]` or `orient=[0,1,0]`). Never pass unassigned alphabetic tokens like `X` or `Y` to orientation nodes.
   * ❌ BAD:  `cyl(h=10, d=5, orient=Y)`
   * ✅ GOOD: `cyl(h=10, d=5, orient=[0,1,0])`
4. **Named Arguments Only**: Always use named BOSL2 arguments — never positional.

Output the ENTIRE updated OpenSCAD file text block containing the fixes. Partial code snippets are completely unacceptable.
""".strip()

class EditCadUseCase(UseCaseBase):
    """Interactor orchestrating surgical changes on current OpenSCAD codebase based on target clicks."""
    
    def __init__(self, llm_gateway: ILLMProviderGateway, session_repo: ISessionRepository) -> None:
        super().__init__()
        self.llm_gateway = llm_gateway
        self.session_repo = session_repo

    async def execute(
        self,
        prompt: str,
        current_code: str,
        primary_metadata: ModelMetadata,
        fallback_metadata: ModelMetadata | None = None,
        target_point: list[float] | None = None,
        session_id: str | None = None,
    ) -> str:
        self.logger.info(f"Executing EditCadUseCase. prompt='{prompt}', target_point={target_point}, session_id='{session_id}'")
        user_prompt = prompt
        if target_point and len(target_point) == 3:
            x, y, z = target_point
            user_prompt += (
                f"\n\n[System Context: User clicked absolute coordinates X: {x}, Y: {y}, Z: {z}. "
                f"Surgically modify geometry at or near this coordinate location.]"
            )

        user_text = f"CURRENT_CODE:\n{current_code}\n\nUSER_REQUEST:\n{user_prompt}"

        # Setup retry runner using standard fallback loop from GenerateCadUseCase
        fallback_interactor = GenerateCadUseCase(self.llm_gateway, self.session_repo)
        raw_code = await fallback_interactor._execute_with_fallback(
            prompt=user_text,
            primary_metadata=primary_metadata,
            fallback_metadata=fallback_metadata,
            system_instruction=EDIT_SYSTEM_PROMPT,
            response_json=False,
        )

        script = self._normalize_script(raw_code)
        final_script = self._validate_and_repair(script)

        if session_id:
            history_item = HistoryItem(
                id=str(uuid.uuid4()),
                sessionId=session_id,
                actionType="EDIT",
                prompt=prompt,
                openscadCode=final_script,
                isFullSnapshot=False,
                targetPoint=target_point or [],
                createdAt=datetime.utcnow()
            )
            await self.session_repo.append_history_item(session_id, history_item)

        self.logger.info("EditCadUseCase completed successfully.")
        return final_script
