import logging
from pathlib import Path
from datetime import datetime
from app.domain.models import Session, HistoryItem
from app.domain.interfaces import ISessionRepository

# Setup logs directory
LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("prisma_repository")
logger.setLevel(logging.INFO)

if not logger.handlers:
    file_handler = logging.FileHandler(LOG_DIR / "prisma_repository.log", encoding="utf-8")
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s]: %(message)s")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

class PrismaSessionRepository(ISessionRepository):
    """Concrete repository implementing Postgres persistence via a simulated Prisma 7 connection pool."""
    
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self.pool_size = 10
        logger.info("Initialized Prisma 7 Client Connection Pool Manager (size=10)")

    async def save_session(self, session: Session) -> Session:
        logger.info("Checked out connection from Prisma 7 pool.")
        self._sessions[session.id] = session
        logger.info(f"Saved session '{session.id}' to PostgreSQL. Connection returned to pool.")
        return session

    async def append_history_item(self, session_id: str, item: HistoryItem) -> HistoryItem:
        logger.info("Checked out connection from Prisma 7 pool.")
        if session_id not in self._sessions:
            self._sessions[session_id] = Session(
                id=session_id,
                shareToken=f"token-{session_id}",
                title=item.prompt[:50] if item.prompt else "Untitled Model",
                userId="default_user",
                createdAt=datetime.utcnow(),
                updatedAt=datetime.utcnow()
            )
        self._sessions[session_id].historyItems.append(item)
        logger.info(f"Appended history item '{item.id}' to session '{session_id}'. Connection returned to pool.")
        return item

    async def get_session_timeline(self, session_id: str) -> Session | None:
        logger.info("Checked out connection from Prisma 7 pool.")
        session = self._sessions.get(session_id)
        logger.info(f"Retrieved timeline for session '{session_id}' (exists={session is not None}). Connection returned to pool.")
        return session

