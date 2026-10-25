from typing import Literal

from fastapi import APIRouter, Depends, File, Path, Query, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_company_permission
from app.auth.permissions import CompanyPermission as P
from app.core.db import get_db
from app.core.rate_limit import limiter
from app.schemas.document import DocumentRead
from app.services import document_service
from app.services.access_service import CompanyContext

router = APIRouter(prefix="/companies/{company_id}/documents", tags=["documents"])


@router.post("", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def upload_bill(
    request: Request,
    kind: Literal["purchase", "sale"] = Query(...),
    file: UploadFile = File(...),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW)),
    db: AsyncSession = Depends(get_db),
) -> DocumentRead:
    """Upload a bill (PDF, JPG or PNG, up to 10 MB) and get back what was read from it.
    Nothing is entered yet: the person checks the values, then creates the entry with
    `document_id` set to link the two."""
    doc = await document_service.upload(db, ctx, kind, file, request)
    return await document_service.to_read(db, doc)


@router.get("/{document_id}", response_model=DocumentRead)
async def get_document(
    document_id: int = Path(gt=0),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW)),
    db: AsyncSession = Depends(get_db),
) -> DocumentRead:
    return await document_service.to_read(
        db, await document_service.get_visible(db, ctx, document_id)
    )


@router.get("/{document_id}/file")
async def download_bill(
    document_id: int = Path(gt=0),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    doc = await document_service.get_visible(db, ctx, document_id)
    await db.refresh(doc, ["content"])  # the file bytes are deferred; load them only here
    return Response(
        content=doc.content,
        # Only types we checked from the file's own bytes at upload.
        media_type=doc.content_type,
        headers={
            "Content-Disposition": f'inline; filename="{doc.filename}"',
            "Cache-Control": "no-store",
        },
    )
