from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.models.base import Base


class Document(Base):
    """An uploaded bill (PDF or photo), what was read from it, and the entry it became.

    The file is kept in the database so it travels with the data and its backups. `content`
    is deferred: listing or linking documents never loads the file bytes.
    """

    __tablename__ = "documents"
    # The same file uploaded twice in one company is the same document.
    __table_args__ = (UniqueConstraint("company_id", "sha256", name="uq_documents_company_sha256"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(20))  # purchase | sale
    filename: Mapped[str] = mapped_column(String(100))
    content_type: Mapped[str] = mapped_column(String(50))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    content: Mapped[bytes] = deferred(mapped_column(LargeBinary))
    method: Mapped[str] = mapped_column(String(20))  # pdf_text | ocr | none
    pages: Mapped[int] = mapped_column(Integer, default=1)
    parsed: Mapped[dict] = mapped_column(JSONB, default=dict)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # The purchase or sale made from this bill (its table is given by `kind`).
    entry_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
