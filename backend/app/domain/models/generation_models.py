from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field

class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

class ModelMetadata(BaseModel):
    """Domain model metadata configuration passed by the client."""
    id: str
    name: str
    vendor: Literal['google', 'deepseek', 'anthropic', 'openai', 'ollama']
    tier: Literal['flash', 'pro', 'ultra']
    maxTokens: int
    supportsThinking: bool
    fallbackModelId: str | None = None
    description: str | None = None
    badge: str | None = None

class HistoryItem(BaseModel):
    """Pure domain entity representing a historical geometric snapshot or surgical edit action."""
    id: str
    sessionId: str
    actionType: Literal['GENERATE', 'EDIT', 'IMPORT']
    prompt: str | None = None
    openscadCode: str | None = None
    patchDelta: str | None = None
    isFullSnapshot: bool = False
    parametersJson: Any = None
    targetPoint: list[float] = Field(default_factory=list)
    metaData: Any = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)

class Session(BaseModel):
    """Pure domain entity representing a persistent multi-view 3D CAD design session."""
    id: str
    shareToken: str
    title: str
    userId: str
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)
    historyItems: list[HistoryItem] = Field(default_factory=list)

class GenerateResponse(StrictModel):
    """Payload returned after a successful two-stage generation run."""
    openscad_script: str
    parameters: dict[str, Any] = Field(default_factory=dict)
