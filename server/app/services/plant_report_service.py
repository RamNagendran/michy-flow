"""How each operator and machine performed over a period. Manager and Super Admin only.

Every operator on a run is credited with the whole run (runs, hours and kg), the same as the
shift report. Each run is on one machine; runs saved before machines show under none.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import ColumnElement, Integer, String, cast, func, literal, null, select, union_all
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.periods import periods, truncate
from app.models import Machine, Operator, Production
from app.models.enums import EntryStatus
from app.schemas.analytics import PlantFigures, PlantPoint, PlantReport, PlantRow

_ZERO = Decimal(0)
# The sums for no runs at all.
_NONE = (0, _ZERO, 0, _ZERO, _ZERO, _ZERO, _ZERO)


@dataclass(frozen=True, slots=True)
class PlantFilters:
    shifts: tuple[int, ...] = ()
    machine_ids: tuple[int, ...] = ()
    operator_ids: tuple[int, ...] = ()


def _where(company_id: int, d_from: date, d_to: date, f: PlantFilters) -> list[ColumnElement]:
    where = [
        Production.company_id == company_id,
        Production.entry_date.between(d_from, d_to),
        Production.deleted_at.is_(None),
        Production.status != EntryStatus.REJECTED,
    ]
    if f.shifts:
        where.append(Production.shift.in_(f.shifts))
    if f.machine_ids:
        where.append(Production.machine_id.in_(f.machine_ids))
    if f.operator_ids:
        # Runs any of the chosen operators were on.
        where.append(Production.crew_ids.overlap(array(f.operator_ids, type_=Integer)))
    return where


_processed = Production.input_kg - Production.returned_kg
# runs, hours, runs that logged hours, processed, output, wastage, processed over timed runs
_SUMS = (
    func.count(),
    func.coalesce(func.sum(Production.running_hours), 0),
    func.count(Production.running_hours),
    func.coalesce(func.sum(_processed), 0),
    func.coalesce(func.sum(Production.output_kg), 0),
    func.coalesce(func.sum(Production.wastage_kg), 0),
    func.coalesce(func.sum(_processed).filter(Production.running_hours.is_not(None)), 0),
)


def _figures(runs, hours, logged, done, output, wastage, timed, shift_hours) -> dict:  # noqa: ANN001
    return {
        "runs": runs,
        "hours": hours,
        "processed_kg": done,
        "output_kg": output,
        "wastage_kg": wastage,
        "wastage_pct": round(wastage / done * 100, 2) if done else _ZERO,
        "kg_per_hour": round(timed / hours, 1) if hours else None,
        "efficiency_pct": round(hours / (logged * shift_hours) * 100, 1) if logged else None,
    }


async def plant_report(
    db: AsyncSession,
    company_id: int,
    d_from: date,
    d_to: date,
    unit: str,
    f: PlantFilters,
) -> PlantReport:
    shift_hours = Decimal(str(settings.SHIFT_HOURS))
    where = _where(company_id, d_from, d_to, f)

    # FROM production, unnest(production.crew_ids) AS crew(member): implicitly lateral.
    crew = (
        func.unnest(Production.crew_ids)
        .table_valued("member", joins_implicitly=True)
        .render_derived(name="crew")
    )
    member = crew.c.member
    period = truncate(Production.entry_date, unit)
    # Totals, per operator, per machine and per period in one round trip. The first column says
    # which; the second is the operator, machine (0: none) or period start, as text.
    query = union_all(
        select(literal("total"), literal(""), *_SUMS).where(*where),
        select(literal("operator"), cast(member, String), *_SUMS)
        .select_from(Production)
        .where(*where, *((member.in_(f.operator_ids),) if f.operator_ids else ()))
        .group_by(member),
        select(literal("machine"), cast(func.coalesce(Production.machine_id, 0), String), *_SUMS)
        .where(*where)
        .group_by(Production.machine_id),
        select(literal("period"), cast(period, String), *_SUMS).where(*where).group_by(period),
    )
    found: dict[str, dict[str, tuple]] = {"total": {}, "operator": {}, "machine": {}, "period": {}}
    for kind, key, *sums in await db.execute(query):
        found[kind][key] = tuple(sums)
    operators = {int(k): v for k, v in found["operator"].items()}
    machines = {int(k): v for k, v in found["machine"].items()}

    names = await _names(db, list(operators), list(machines))
    trend = []
    for p in periods(d_from, d_to, unit):
        runs, hours, _, done, output, wastage, _ = found["period"].get(p.isoformat(), _NONE)
        trend.append(
            PlantPoint(
                period=p,
                runs=runs,
                hours=hours,
                processed_kg=done,
                output_kg=output,
                wastage_kg=wastage,
            )
        )

    def rows(found: dict[int, tuple], kind: str) -> list[PlantRow]:
        out = []
        for key, sums in found.items():
            name, code, active = names.get((kind, key), ("Former " + kind, None, False))
            if kind == "machine" and key == 0:
                name, code, active = "No machine (older runs)", None, False
            out.append(
                PlantRow(
                    id=key,
                    name=name,
                    code=code,
                    is_active=active,
                    **_figures(*sums, shift_hours),
                )
            )
        return sorted(out, key=lambda r: -r.processed_kg)

    return PlantReport(
        shift_hours=shift_hours,
        bucket=unit,
        totals=PlantFigures(**_figures(*found["total"].get("", _NONE), shift_hours)),
        by_operator=rows(operators, "operator"),
        by_machine=rows(machines, "machine"),
        trend=trend,
    )


async def _names(
    db: AsyncSession, operator_ids: list[int], machine_ids: list[int]
) -> dict[tuple[str, int], tuple[str, str | None, bool]]:
    """{(kind, id): (name, machine number, active)} for both lists in one round trip."""
    if not operator_ids and not machine_ids:
        return {}
    query = union_all(
        select(
            literal("operator"),
            Operator.id,
            Operator.name,
            cast(null(), String),
            Operator.is_active,
        ).where(Operator.id.in_(operator_ids)),
        select(literal("machine"), Machine.id, Machine.name, Machine.code, Machine.is_active).where(
            Machine.id.in_(machine_ids)
        ),
    )
    return {(k, i): (n, c, a) for k, i, n, c, a in await db.execute(query)}
