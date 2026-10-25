"""Company types, units (oil in litres), returns to stock and the reverse calculation."""

from decimal import Decimal

from httpx import AsyncClient

from app.parsing.fields import parse_lines
from tests.bill_samples import OUR_GSTIN, SELLER_GSTIN
from tests.conftest import bearer
from tests.entry_helpers import TODAY, Team, purchase, stock_of, team


async def _run(client: AsyncClient, t: Team, material: str, input_kg: str, outputs: dict, **extra):  # noqa: ANN001, ANN202
    body = {
        "entry_date": TODAY,
        "material": material,
        "input_kg": input_kg,
        "outputs": [{"product": p, "qty": q} for p, q in outputs.items()],
        **extra,
    }
    return await client.post(t.url("/production"), json=body, headers=bearer(t.admin))


async def _sell(client: AsyncClient, t: Team, item: str, qty: str, rate: str, **extra):  # noqa: ANN001, ANN202
    body = {
        "entry_date": TODAY,
        "buyer_id": t.buyer,
        "product": item,
        "qty": qty,
        "rate": rate,
        "invoice_no": f"S-{item}-{qty}",
        **extra,
    }
    return await client.post(t.url("/sales"), json=body, headers=bearer(t.admin))


async def test_pyrolysis_run_balances_by_weight_with_oil_in_litres(client: AsyncClient) -> None:
    t = await team(client, "pyrolysis")
    assert t.company["category"] == "pyrolysis"
    await purchase(client, t, t.admin, "10000", material="tractor")
    res = await _run(
        client,
        t,
        "tractor",
        "10000",
        {"oil": "4000", "carbon": "2600", "steel": "1500", "waste_water": "720"},
        returned_kg="500",
    )
    assert res.status_code == 201, res.text
    run = res.json()
    # 4000 L of oil at the default 1.04 kg/L = 4160 kg. Processed 9500 kg, outputs 8980 kg.
    assert run["processed_kg"] == 9500 and run["output_kg"] == 8980
    assert run["wastage_kg"] == 520 and run["wastage_flagged"] is True
    oil = next(o for o in run["outputs"] if o["product"] == "oil")
    assert (oil["qty"], oil["unit"], oil["qty_kg"]) == (4000, "L", 4160)

    # The 500 kg put back stays in stock; only what was processed is taken out.
    assert (await stock_of(client, t, "tractor"))["provisional"]["balance"] == 500
    line = await stock_of(client, t, "oil", "output")
    assert line["unit"] == "L" and line["provisional"]["balance"] == 4000

    sold = await _sell(client, t, "oil", "1000", "42.5")
    assert sold.status_code == 201, sold.text
    assert (sold.json()["unit"], sold.json()["amount"]) == ("L", 42500)
    assert (await stock_of(client, t, "oil", "output"))["provisional"]["balance"] == 3000

    summary = await client.get(
        t.url(f"/summary?date_from={TODAY}&date_to={TODAY}"), headers=bearer(t.admin)
    )
    s = summary.json()
    assert (s["sales"]["qty_l"], s["sales"]["qty_kg"]) == (1000, 0)
    assert s["production"]["returned_kg"] == 500


async def test_small_losses_are_not_flagged(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "1000")
    run = (await _run(client, t, "truck", "1000", {"rubber": "700", "steel": "285"})).json()
    assert run["wastage_pct"] == 1.5 and run["wastage_flagged"] is False


async def test_each_type_makes_only_its_own_products(client: AsyncClient) -> None:
    crumb = await team(client)
    await purchase(client, crumb, crumb.admin, "1000")
    oil = await _run(client, crumb, "truck", "1000", {"oil": "100"})
    assert oil.status_code == 422 and oil.json()["code"] == "item_not_allowed"


async def test_steel_plant_processes_scrap_steel(client: AsyncClient) -> None:
    t = await team(client, "steel")
    tyres = await purchase(client, t, t.admin, "500")
    assert tyres.status_code == 422 and tyres.json()["code"] == "item_not_allowed"
    assert (await purchase(client, t, t.admin, "2000", material="scrap_steel")).status_code == 201
    run = await _run(client, t, "scrap_steel", "2000", {"steel": "1900", "waste": "70"})
    assert run.status_code == 201, run.text
    assert run.json()["wastage_kg"] == 30
    # Weighed waste is recorded but never stocked or sold.
    stock = (await client.get(t.url("/stock"), headers=bearer(t.admin))).json()
    assert [line["item"] for line in stock["output"]] == ["steel"]
    assert (await _sell(client, t, "waste", "10", "1", grade="C")).status_code == 422


async def test_outputs_cannot_outweigh_what_was_processed(client: AsyncClient) -> None:
    t = await team(client, "pyrolysis")
    await purchase(client, t, t.admin, "1000", material="car")
    # 1000 L of oil weighs 1040 kg; with 100 kg returned only 900 kg was processed.
    res = await _run(client, t, "car", "1000", {"oil": "1000"}, returned_kg="100")
    assert res.status_code == 422
    everything_back = await _run(client, t, "car", "1000", {"oil": "1"}, returned_kg="1000")
    assert everything_back.status_code == 422


async def test_company_type_is_fixed_once_entries_exist(client: AsyncClient) -> None:
    t = await team(client)
    change = await client.patch(t.url(), json={"category": "steel"}, headers=bearer(t.super_admin))
    assert change.status_code == 200 and change.json()["category"] == "steel"
    await client.patch(t.url(), json={"category": "crumb"}, headers=bearer(t.super_admin))
    await purchase(client, t, t.admin, "100")
    locked = await client.patch(t.url(), json={"category": "steel"}, headers=bearer(t.super_admin))
    assert locked.status_code == 409 and locked.json()["code"] == "category_locked"


def test_oil_bill_is_read_in_litres() -> None:
    lines = [
        "Jacks Green Tech",
        f"GSTIN: {OUR_GSTIN}",
        "Invoice No: JGT/26-27/0091 Date: 05-Oct-2026",
        f"Bill To: Apex Fuels GSTIN: {SELLER_GSTIN}",
        "Tyre Pyrolysis Oil 27101990 12 KL 42,000.00 5,04,000.00",
    ]
    bill = parse_lines(lines, [1.0] * len(lines), "sale", None)
    assert bill.item.value == "oil" and bill.grade == "A"
    assert (bill.unit_on_bill, bill.unit) == ("KL", "L")
    assert bill.qty.value == Decimal("12000")
    assert bill.rate.value == Decimal("42.0000")
