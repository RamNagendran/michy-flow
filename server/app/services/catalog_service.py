"""The account's items and company types: loading them for a request, and the Super Admin's
changes. Every change gives the account a new catalog_version, so each server reloads its copy.

An item's kind, unit and stock flag change how saved quantities are read, so they lock once
anything uses the item; its name, description and colour can always change. Something in use
cannot be deleted.
"""

import re
from uuid import uuid4

from fastapi import Request
from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InvalidError, NotFoundError
from app.models import (
    Account,
    CatalogItem,
    Company,
    CompanyType,
    DebitNote,
    Production,
    ProductionOutput,
    Purchase,
    Sale,
    StockCheckLine,
    User,
    WastageAdjustment,
    catalog,
)
from app.models.catalog import DEFAULT_ITEMS, DEFAULT_TYPES, Catalog, ItemSpec, Process
from app.schemas.catalog import (
    CatalogRead,
    ItemCreate,
    ItemRead,
    ItemUpdate,
    TypeCreate,
    TypeRead,
    TypeUpdate,
)
from app.services import audit_service

# One copy per account, replaced when the account's catalog_version moves on.
_loaded: dict[int, Catalog] = {}


async def use_for(db: AsyncSession, account: Account) -> Catalog:
    """Make the account's catalogue the one this request reads (models/catalog.py)."""
    cached = _loaded.get(account.id)
    if cached is None or cached.version != account.catalog_version:
        items = await _items(db, account.id)
        types = await _types(db, account.id)
        cached = Catalog(
            items={i.key: ItemSpec(i.unit, i.kind, i.stocked) for i in items},
            types={t.key: Process(tuple(t.input_items), tuple(t.output_items)) for t in types},
            version=account.catalog_version,
        )
        _loaded[account.id] = cached
    catalog.use(cached)
    return cached


def seed(db: AsyncSession, account_id: int) -> None:
    """A new account's starting items and company types (models/catalog.py)."""
    for pos, (key, name, desc, kind, unit, stocked, color) in enumerate(DEFAULT_ITEMS):
        db.add(
            CatalogItem(
                account_id=account_id,
                key=key,
                name=name,
                description=desc,
                kind=kind,
                unit=unit,
                stocked=stocked,
                color=color,
                position=pos,
            )
        )
    for pos, (key, name, example, inputs, outputs) in enumerate(DEFAULT_TYPES):
        db.add(
            CompanyType(
                account_id=account_id,
                key=key,
                name=name,
                example=example,
                input_items=list(inputs),
                output_items=list(outputs),
                position=pos,
            )
        )


async def _items(db: AsyncSession, account_id: int) -> list[CatalogItem]:
    rows = await db.scalars(
        select(CatalogItem)
        .where(CatalogItem.account_id == account_id)
        .order_by(CatalogItem.position, CatalogItem.id)
    )
    return list(rows.all())


async def _types(db: AsyncSession, account_id: int) -> list[CompanyType]:
    rows = await db.scalars(
        select(CompanyType)
        .where(CompanyType.account_id == account_id)
        .order_by(CompanyType.position, CompanyType.id)
    )
    return list(rows.all())


async def read(db: AsyncSession, account: Account) -> CatalogRead:
    counts = dict(
        (
            await db.execute(
                select(Company.category, func.count())
                .where(Company.account_id == account.id)
                .group_by(Company.category)
            )
        ).all()
    )
    types = [
        TypeRead.model_validate(t).model_copy(update={"companies": counts.get(t.key, 0)})
        for t in await _types(db, account.id)
    ]
    items = [ItemRead.model_validate(i) for i in await _items(db, account.id)]
    return CatalogRead(version=account.catalog_version, items=items, types=types)


def check_lists(inputs: list[str], outputs: list[str]) -> None:
    """Inputs must be stocked items; outputs must be products, at least one of them stocked.
    Read from the request's catalogue, which use_for loaded fresh."""
    for name, items, allowed in (
        ("input", inputs, catalog.input_choices()),
        ("output", outputs, catalog.output_choices()),
    ):
        if unknown := [i for i in items if i not in allowed]:
            raise InvalidError(f"Unknown {name} items: {', '.join(unknown)}", code="unknown_item")
    if not any(catalog.is_stocked(o) for o in outputs):
        raise InvalidError("Choose at least one output that goes into stock")


def _new_key(name: str, taken: set[str]) -> str:
    """A short key made from the name, e.g. "Rubber powder" → rubber_powder."""
    base = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:16] or "item"
    key, n = base, 2
    while key in taken:
        key, n = f"{base}_{n}", n + 1
    return key


def _bump(actor: User) -> None:
    actor.account.catalog_version = uuid4().hex


def _audit(
    db: AsyncSession, actor: User, action: str, entity: str, row_id: int, details: dict, request
) -> None:
    audit_service.record(
        db,
        account_id=actor.account_id,
        actor=actor,
        action=action,
        entity_type=entity,
        entity_id=row_id,
        details=details,
        request=request,
    )


async def _get(db: AsyncSession, model: type, account_id: int, row_id: int):
    row = await db.get(model, row_id)
    if not row or row.account_id != account_id:
        raise NotFoundError("Not found")
    return row


async def _item_used_by(db: AsyncSession, account_id: int, key: str) -> list[str]:
    """Where the item is used, in words. Empty when it is free to change or delete."""
    ours = select(Company.id).where(Company.account_id == account_id)
    checks = {
        "purchases": exists().where(Purchase.material == key, Purchase.company_id.in_(ours)),
        "sales": exists().where(Sale.product == key, Sale.company_id.in_(ours)),
        "production": exists().where(
            or_(
                Production.material == key,
                Production.id.in_(
                    select(ProductionOutput.production_id).where(ProductionOutput.product == key)
                ),
            ),
            Production.company_id.in_(ours),
        ),
        "debit notes": exists().where(DebitNote.item == key, DebitNote.company_id.in_(ours)),
        "stock checks": exists().where(
            StockCheckLine.item == key, StockCheckLine.company_id.in_(ours)
        ),
        "wastage": exists().where(
            WastageAdjustment.item == key, WastageAdjustment.company_id.in_(ours)
        ),
    }
    row = (
        await db.execute(select(*(c.label(f"c{i}") for i, c in enumerate(checks.values()))))
    ).one()
    used = [label for label, hit in zip(checks, row, strict=True) if hit]
    lists = or_(Company.input_items.any(key), Company.output_items.any(key))
    used += [
        f"company {n}"
        for n in await db.scalars(
            select(Company.name).where(Company.account_id == account_id, lists)
        )
    ]
    type_lists = or_(CompanyType.input_items.any(key), CompanyType.output_items.any(key))
    used += [
        f"company type {n}"
        for n in await db.scalars(
            select(CompanyType.name).where(CompanyType.account_id == account_id, type_lists)
        )
    ]
    return used


async def create_item(
    db: AsyncSession, actor: User, data: ItemCreate, request: Request | None = None
) -> CatalogItem:
    items = await _items(db, actor.account_id)
    if any(i.name.lower() == data.name.lower() for i in items):
        raise ConflictError(f"An item called {data.name} already exists")
    item = CatalogItem(
        account_id=actor.account_id,
        key=_new_key(data.name, {i.key for i in items}),
        position=max((i.position for i in items), default=-1) + 1,
        **data.model_dump(),
    )
    db.add(item)
    _bump(actor)
    await db.flush()
    _audit(db, actor, "item_created", "item", item.id, data.model_dump(), request)
    await db.commit()
    return item


async def update_item(
    db: AsyncSession, actor: User, item_id: int, data: ItemUpdate, request: Request | None = None
) -> CatalogItem:
    item = await _get(db, CatalogItem, actor.account_id, item_id)
    changes = {
        k: v
        for k, v in data.model_dump(exclude_unset=True).items()
        if v is not None and getattr(item, k) != v
    }
    if not changes:
        return item
    kind, stocked = changes.get("kind", item.kind), changes.get("stocked", item.stocked)
    if kind == "material" and not stocked:
        raise InvalidError("Raw material always goes into stock")
    if "name" in changes:
        same = await db.scalar(
            select(CatalogItem.id).where(
                CatalogItem.account_id == actor.account_id,
                func.lower(CatalogItem.name) == changes["name"].lower(),
                CatalogItem.id != item.id,
            )
        )
        if same:
            raise ConflictError(f"An item called {changes['name']} already exists")
    locked = [k for k in ("kind", "unit", "stocked") if k in changes]
    if locked and (used := await _item_used_by(db, actor.account_id, item.key)):
        raise ConflictError(
            f"{item.name} is already used in {', '.join(used)}, so its type, unit and stock "
            "setting cannot change. You can still rename it.",
            code="item_in_use",
        )
    for k, v in changes.items():
        setattr(item, k, v)
    _bump(actor)
    _audit(
        db, actor, "item_updated", "item", item.id, {"key": item.key, "changes": changes}, request
    )
    await db.commit()
    return item


async def delete_item(
    db: AsyncSession, actor: User, item_id: int, request: Request | None = None
) -> None:
    item = await _get(db, CatalogItem, actor.account_id, item_id)
    if used := await _item_used_by(db, actor.account_id, item.key):
        raise ConflictError(
            f"{item.name} is used in {', '.join(used)}, so it cannot be deleted.",
            code="item_in_use",
        )
    await db.delete(item)
    _bump(actor)
    _audit(
        db, actor, "item_deleted", "item", item.id, {"key": item.key, "name": item.name}, request
    )
    await db.commit()


async def create_type(
    db: AsyncSession, actor: User, data: TypeCreate, request: Request | None = None
) -> TypeRead:
    check_lists(data.input_items, data.output_items)
    types = await _types(db, actor.account_id)
    if any(t.name.lower() == data.name.lower() for t in types):
        raise ConflictError(f"A company type called {data.name} already exists")
    row = CompanyType(
        account_id=actor.account_id,
        key=_new_key(data.name, {t.key for t in types}),
        position=max((t.position for t in types), default=-1) + 1,
        **data.model_dump(),
    )
    db.add(row)
    _bump(actor)
    await db.flush()
    _audit(db, actor, "company_type_created", "company_type", row.id, data.model_dump(), request)
    await db.commit()
    return TypeRead.model_validate(row)


async def update_type(
    db: AsyncSession, actor: User, type_id: int, data: TypeUpdate, request: Request | None = None
) -> TypeRead:
    """Changes the defaults for companies made from now on; existing companies keep theirs."""
    row = await _get(db, CompanyType, actor.account_id, type_id)
    changes = {
        k: v
        for k, v in data.model_dump(exclude_unset=True).items()
        if v is not None and getattr(row, k) != v
    }
    if changes:
        check_lists(
            changes.get("input_items", row.input_items),
            changes.get("output_items", row.output_items),
        )
        if "name" in changes and any(
            t.name.lower() == changes["name"].lower() and t.id != row.id
            for t in await _types(db, actor.account_id)
        ):
            raise ConflictError(f"A company type called {changes['name']} already exists")
        for k, v in changes.items():
            setattr(row, k, v)
        _bump(actor)
        details = {"key": row.key, "changes": changes}
        _audit(db, actor, "company_type_updated", "company_type", row.id, details, request)
        await db.commit()
    count = await db.scalar(
        select(func.count()).where(
            Company.account_id == actor.account_id, Company.category == row.key
        )
    )
    return TypeRead.model_validate(row).model_copy(update={"companies": count or 0})


async def delete_type(
    db: AsyncSession, actor: User, type_id: int, request: Request | None = None
) -> None:
    row = await _get(db, CompanyType, actor.account_id, type_id)
    names = list(
        await db.scalars(
            select(Company.name).where(
                Company.account_id == actor.account_id, Company.category == row.key
            )
        )
    )
    if names:
        raise ConflictError(
            f"{row.name} is the type of {', '.join(names)}, so it cannot be deleted.",
            code="type_in_use",
        )
    await db.delete(row)
    _bump(actor)
    details = {"key": row.key, "name": row.name}
    _audit(db, actor, "company_type_deleted", "company_type", row.id, details, request)
    await db.commit()
