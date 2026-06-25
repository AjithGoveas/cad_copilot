from abc import ABC, abstractmethod
from app.domain.models import Session, HistoryItem

class ISessionRepository(ABC):
    """Abstract contract for CAD Session and History database persistence."""
    
    @abstractmethod
    async def save_session(self, session: Session) -> Session:
        """Saves or initializes a CAD session."""
        pass

    @abstractmethod
    async def append_history_item(self, session_id: str, item: HistoryItem) -> HistoryItem:
        """Appends a new geometric edit delta or snapshot to the session history."""
        pass

    @abstractmethod
    async def get_session_timeline(self, session_id: str) -> Session | None:
        """Retrieves a session's metadata and chronological action timeline."""
        pass
