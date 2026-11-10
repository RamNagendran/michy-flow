from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, require_system_permission
from app.auth.permissions import SystemPermission
from app.core.db import get_db
from app.models import CatalogItem, User
from app.realtime import events
from app.schemas.catalog import (
    CatalogRead,
    ItemCreate,
    ItemRead,
    ItemUpdate,
    TypeCreate,
    TypeRead,
    TypeUpdate,
)
from app.services import catalog_service

router = APIRouter(prefix="/catalog", tags=["catalog"])

# Only the Super Admin changes items and company types.
_manage = require_system_permission(SystemPermission.MANAGE_CONFIG)


@router.get("", response_model=CatalogRead)
async def get_catalog(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> CatalogRead:
    """The account's items and company types. Everyone signed in needs them to show entries."""
    return await catalog_service.read(db, user.account)


@router.post("/items", response_model=ItemRead, status_code=status.HTTP_201_CREATED)
async def create_item(
    request: Request,
    data: ItemCreate,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> CatalogItem:
    item = await catalog_service.create_item(db, actor, data, request)
    await events.catalog_changed(actor.account_id)
    return item


@router.patch("/items/{item_id}", response_model=ItemRead)
async def update_item(
    request: Request,
    item_id: int,
    data: ItemUpdate,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> CatalogItem:
    item = await catalog_service.update_item(db, actor, item_id, data, request)
    await events.catalog_changed(actor.account_id)
    return item


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    request: Request,
    item_id: int,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await catalog_service.delete_item(db, actor, item_id, request)
    await events.catalog_changed(actor.account_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/types", response_model=TypeRead, status_code=status.HTTP_201_CREATED)
async def create_type(
    request: Request,
    data: TypeCreate,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> TypeRead:
    row = await catalog_service.create_type(db, actor, data, request)
    await events.catalog_changed(actor.account_id)
    return row


@router.patch("/types/{type_id}", response_model=TypeRead)
async def update_type(
    request: Request,
    type_id: int,
    data: TypeUpdate,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> TypeRead:
    row = await catalog_service.update_type(db, actor, type_id, data, request)
    await events.catalog_changed(actor.account_id)
    return row


@router.delete("/types/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_type(
    request: Request,
    type_id: int,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await catalog_service.delete_type(db, actor, type_id, request)
    await events.catalog_changed(actor.account_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
