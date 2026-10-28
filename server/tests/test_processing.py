"""Company types, units (oil in litres) and working out the raw material used."""

from decimal import Decimal

from httpx import AsyncClient

from app.parsing.fields import parse_lines
from tests.bill_samples import OUR_GSTIN, SELLER_GSTIN
from tests.conftest import bearer
from tests.entry_helpers import TODAY, Team, approve_new, purchase, stock_of, team


async def _run(client: AsyncClient, t: Team, material: str, outputs: dict, **extra):  # noqa: ANN001, ANN202
    body = {
        "entry_date": TODAY,
        "material": material,
        "outputs": [{"product": p, "qty": q} for p, q in outputs.items()],
        **extra,
    }
    res = await client.post(t.url("/production"), json=body, headers=bearer(t.admin))
    return await approve_new(client, t, res)


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
    res = await client.post(t.url("/sales"), json=body, headers=bearer(t.admin))
    return await approve_new(client, t, res)


async def test_pyrolysis_run_works_out_input_with_oil_in_litres(client: AsyncClient) -> None:
    t = await team(client, "pyrolysis")
    assert t.company["category"] == "pyrolysis"
    await purchase(client, t, t.admin, "10000", material="tractor")
    outputs = {"oil": "4000", "carbon": "2600", "steel": "1500", "waste_water": "720"}
    res = await _run(client, t, "tractor", outputs)
    assert res.status_code == 201, res.text
    run = res.json()
    # 4000 L of oil at the default 1.04 kg/L = 4160 kg, so 8980 kg came out.
    assert run["output_kg"] == 8980 and run["wastage_kg"] == 179.6  # 2% of 8980
    assert run["calculated_input_kg"] == 9160 and run["processed_kg"] == 9160
    assert run["wastage_flagged"] is False
    oil = next(o for o in run["outputs"] if o["product"] == "oil")
    assert (oil["qty"], oil["unit"], oil["qty_kg"]) == (4000, "L", 4160)

    # Stock goes down by the outputs + 2%.
    assert (await stock_of(client, t, "tractor"))["provisional"]["balance"] == 840
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


async def test_a_bigger_total_changes_only_the_wastage(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "1000")
    out = {"rubber": "700", "steel": "200"}
    run = (await _run(client, t, "truck", out, wastage_on_kg="1000")).json()
    # 900 kg out, 918 kg worked out. The 1000 kg is used only for the wastage (2% = 20 kg).
    assert run["calculated_input_kg"] == 918 and run["processed_kg"] == 918
    assert run["wastage_kg"] == 20 and run["wastage_pct"] == 2.0
    assert (await stock_of(client, t, "truck"))["provisional"]["balance"] == 82
    low = await _run(client, t, "truck", out, wastage_on_kg="917")
    assert low.status_code == 422 and low.json()["code"] == "input_below_calculated"


async def test_each_type_makes_only_its_own_products(client: AsyncClient) -> None:
    crumb = await team(client)
    await purchase(client, crumb, crumb.admin, "1000")
    oil = await _run(client, crumb, "truck", {"oil": "100"})
    assert oil.status_code == 422 and oil.json()["code"] == "item_not_allowed"


async def test_steel_plant_processes_scrap_steel(client: AsyncClient) -> None:
    t = await team(client, "steel")
    tyres = await purchase(client, t, t.admin, "500")
    assert tyres.status_code == 422 and tyres.json()["code"] == "item_not_allowed"
    assert (await purchase(client, t, t.admin, "2000", material="scrap_steel")).status_code == 201
    run = await _run(client, t, "scrap_steel", {"steel": "1890", "waste": "70"})
    assert run.status_code == 201, run.text
    assert run.json()["wastage_kg"] == 39.2  # 2% of 1960
    # Weighed waste is recorded but never stocked or sold.
    stock = (await client.get(t.url("/stock"), headers=bearer(t.admin))).json()
    assert [line["item"] for line in stock["output"]] == ["steel"]
    assert (await _sell(client, t, "waste", "10", "1", grade="C")).status_code == 422


async def test_outputs_plus_wastage_must_be_in_stock(client: AsyncClient) -> None:
    t = await team(client, "pyrolysis")
    await purchase(client, t, t.admin, "1000", material="car")
    # 1000 L of oil weighs 1040 kg; + 2% is 1061 kg, more than the 1000 kg in stock.
    res = await _run(client, t, "car", {"oil": "1000"})
    assert res.status_code == 409


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
