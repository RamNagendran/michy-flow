"""Items and company types are the Super Admin's to add, change and delete."""

from httpx import AsyncClient

from tests.conftest import bearer, create_company, make_gstin
from tests.entry_helpers import TODAY, purchase, team


async def _catalog(client: AsyncClient, token: str) -> dict:
    res = await client.get("/catalog", headers=bearer(token))
    assert res.status_code == 200, res.text
    return res.json()


async def test_a_new_account_starts_with_the_usual_items_and_types(client: AsyncClient) -> None:
    t = await team(client)
    cat = await _catalog(client, t.operator)  # everyone signed in can read it
    keys = [i["key"] for i in cat["items"]]
    assert keys[:2] == ["truck", "car"] and "oil" in keys and "waste" in keys
    oil = next(i for i in cat["items"] if i["key"] == "oil")
    assert oil["unit"] == "L" and oil["kind"] == "product"
    types = {ty["key"]: ty for ty in cat["types"]}
    assert set(types) == {"pyrolysis", "crumb", "steel"}
    assert types["crumb"]["companies"] == 1


async def test_only_the_super_admin_changes_the_catalogue(client: AsyncClient) -> None:
    t = await team(client)
    body = {"name": "Rubber powder", "kind": "product"}
    for token in (t.manager, t.finance, t.operator):
        res = await client.post("/catalog/items", json=body, headers=bearer(token))
        assert res.status_code == 403


async def test_new_items_and_types_flow_into_companies_and_entries(client: AsyncClient) -> None:
    t = await team(client)
    sa = t.super_admin
    res = await client.post(
        "/catalog/items",
        json={"name": "Conveyor belts", "kind": "material", "color": "#123456"},
        headers=bearer(sa),
    )
    assert res.status_code == 201, res.text
    belt = res.json()
    assert belt["key"] == "conveyor_belts" and belt["unit"] == "kg"
    res = await client.post(
        "/catalog/items", json={"name": "rubber POWDER", "kind": "product"}, headers=bearer(sa)
    )
    powder = res.json()

    # A type may only use items the catalogue has, and must stock at least one output.
    bad = {"name": "Belt recycling", "input_items": ["belts"], "output_items": ["waste"]}
    res = await client.post("/catalog/types", json=bad, headers=bearer(sa))
    assert res.status_code == 422
    bad["input_items"] = ["conveyor_belts"]
    res = await client.post("/catalog/types", json=bad, headers=bearer(sa))
    assert res.status_code == 422
    good = {**bad, "output_items": [powder["key"], "steel", "waste"], "example": "e.g. Belt Co"}
    res = await client.post("/catalog/types", json=good, headers=bearer(sa))
    assert res.status_code == 201, res.text
    belt_type = res.json()

    company = await create_company(client, sa, code="BR", category=belt_type["key"])
    assert company["input_items"] == ["conveyor_belts"]
    assert company["output_items"] == [powder["key"], "steel", "waste"]
    res = await client.post(
        "/companies", json={"code": "ZZ", "name": "Z", "category": "bakery"}, headers=bearer(sa)
    )
    assert res.status_code == 422

    # Bought, run and recorded like any built-in item.
    url = f"/companies/{company['id']}"
    supplier = await client.post(
        f"{url}/parties",
        json={"kind": "supplier", "name": "Belt Traders", "gstin": make_gstin("belts")},
        headers=bearer(sa),
    )
    assert supplier.status_code == 201, supplier.text
    bill = {
        "entry_date": TODAY,
        "supplier_id": supplier.json()["id"],
        "material": "conveyor_belts",
        "qty": "500",
        "rate": "9",
        "invoice_no": "B-1",
    }
    res = await client.post(f"{url}/purchases", json=bill, headers=bearer(sa))
    assert res.status_code == 201, res.text
    assert res.json()["item"] == "conveyor_belts"
    # Truck tyres are not this company's raw material.
    res = await client.post(
        f"{url}/purchases",
        json={**bill, "material": "truck", "invoice_no": "B-2"},
        headers=bearer(sa),
    )
    assert res.status_code == 422


async def test_items_in_use_keep_their_unit_and_cannot_be_deleted(client: AsyncClient) -> None:
    t = await team(client)
    sa = t.super_admin
    await purchase(client, t, t.admin)  # truck tyres
    items = {i["key"]: i for i in (await _catalog(client, sa))["items"]}
    truck = items["truck"]

    res = await client.patch(
        f"/catalog/items/{truck['id']}", json={"unit": "L"}, headers=bearer(sa)
    )
    assert res.status_code == 409 and res.json()["code"] == "item_in_use"
    res = await client.delete(f"/catalog/items/{truck['id']}", headers=bearer(sa))
    assert res.status_code == 409 and "purchases" in res.json()["detail"]
    # Renaming is always fine.
    res = await client.patch(
        f"/catalog/items/{truck['id']}", json={"name": "Lorry tyres"}, headers=bearer(sa)
    )
    assert res.status_code == 200 and res.json()["name"] == "Lorry tyres"
    res = await client.patch(
        f"/catalog/items/{truck['id']}", json={"name": "car TYRES"}, headers=bearer(sa)
    )
    assert res.status_code == 409

    # An item nothing uses can change and go.
    res = await client.post(
        "/catalog/items", json={"name": "Bead wire", "kind": "product"}, headers=bearer(sa)
    )
    wire = res.json()
    res = await client.patch(
        f"/catalog/items/{wire['id']}", json={"unit": "L", "stocked": False}, headers=bearer(sa)
    )
    assert res.status_code == 200 and res.json()["unit"] == "L"
    res = await client.delete(f"/catalog/items/{wire['id']}", headers=bearer(sa))
    assert res.status_code == 204
    assert "bead_wire" not in [i["key"] for i in (await _catalog(client, sa))["items"]]


async def test_company_types_in_use_cannot_be_deleted(client: AsyncClient) -> None:
    t = await team(client)
    sa = t.super_admin
    types = {ty["key"]: ty for ty in (await _catalog(client, sa))["types"]}
    res = await client.delete(f"/catalog/types/{types['crumb']['id']}", headers=bearer(sa))
    assert res.status_code == 409 and "Company MR" in res.json()["detail"]

    # Changing a type's defaults leaves its companies' own lists alone.
    res = await client.patch(
        f"/catalog/types/{types['crumb']['id']}",
        json={"name": "Crumb plant", "output_items": ["rubber", "waste"]},
        headers=bearer(sa),
    )
    assert res.status_code == 200 and res.json()["companies"] == 1
    company = (await client.get(t.url(), headers=bearer(sa))).json()
    assert company["output_items"] == ["rubber", "steel", "other", "waste"]

    res = await client.delete(f"/catalog/types/{types['steel']['id']}", headers=bearer(sa))
    assert res.status_code == 204
    keys = [ty["key"] for ty in (await _catalog(client, sa))["types"]]
    assert keys == ["pyrolysis", "crumb"]
