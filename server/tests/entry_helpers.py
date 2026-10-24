"""Shared setup for the entry tests: one company with a person in every role."""

from dataclasses import dataclass

from httpx import AsyncClient

from tests.conftest import bearer, create_company, create_user, login_new_user, signup

TODAY = "2026-10-01"


@dataclass
class Team:
    company: dict
    super_admin: str
    manager: str
    admin: str
    finance: str
    operator: str
    operator2: str
    supplier: int
    buyer: int

    def url(self, path: str = "") -> str:
        return f"/companies/{self.company['id']}{path}"


async def _member(client: AsyncClient, sa: str, cid: int, email: str, role: str, duties=()) -> str:  # noqa: ANN001
    m = [{"company_id": cid, "role": role, "duties": list(duties)}]
    return await login_new_user(client, await create_user(client, sa, email, memberships=m))


async def team(client: AsyncClient, category: str = "crumb") -> Team:
    sa = (await signup(client))["access_token"]
    company = await create_company(client, sa, code="MR", category=category)
    cid = company["id"]
    all_duties = ("purchase", "sales", "production")
    t = Team(
        company=company,
        super_admin=sa,
        manager=await _member(client, sa, cid, "mgr@example.com", "manager"),
        admin=await _member(client, sa, cid, "adm@example.com", "admin"),
        finance=await _member(client, sa, cid, "fin@example.com", "finance"),
        operator=await _member(client, sa, cid, "ops@example.com", "operator", all_duties),
        operator2=await _member(client, sa, cid, "ops2@example.com", "operator", all_duties),
        supplier=0,
        buyer=0,
    )
    t.supplier = await party(client, t, "supplier", "Sri Balaji Tyres")
    t.buyer = await party(client, t, "buyer", "Apex Mouldings")
    return t


async def party(client: AsyncClient, t: Team, kind: str, name: str, **extra: object) -> int:
    res = await client.post(
        t.url("/parties"), json={"kind": kind, "name": name, **extra}, headers=bearer(t.manager)
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def purchase(client: AsyncClient, t: Team, token: str, qty: str = "1000", **extra: object):  # noqa: ANN201
    body = {
        "entry_date": TODAY,
        "supplier_id": t.supplier,
        "material": "truck",
        "qty": qty,
        "rate": "14.5",
        "invoice_no": f"INV-{qty}-{len(token) % 97}-{extra.pop('n', 1)}",
        **extra,
    }
    return await client.post(t.url("/purchases"), json=body, headers=bearer(token))


async def production(
    client: AsyncClient, t: Team, token: str, input_kg: str, outputs: dict[str, str]
):  # noqa: ANN201
    body = {
        "entry_date": TODAY,
        "material": "truck",
        "input_kg": input_kg,
        "shift": 1,
        "outputs": [{"product": p, "qty": q} for p, q in outputs.items()],
    }
    return await client.post(t.url("/production"), json=body, headers=bearer(token))


async def sale(client: AsyncClient, t: Team, token: str, qty: str, invoice: str = "MR/1"):  # noqa: ANN201
    body = {
        "entry_date": TODAY,
        "buyer_id": t.buyer,
        "product": "rubber",
        "qty": qty,
        "rate": "30",
        "invoice_no": invoice,
    }
    return await client.post(t.url("/sales"), json=body, headers=bearer(token))


async def act(
    client: AsyncClient, t: Team, token: str, entry: dict, action: str, comment: str = ""
):  # noqa: ANN201
    url = t.url(f"/entries/{entry['type']}/{entry['id']}/actions/{action}")
    return await client.post(url, json={"comment": comment}, headers=bearer(token))


async def stock_of(client: AsyncClient, t: Team, item: str, kind: str = "raw") -> dict:
    res = await client.get(t.url("/stock"), headers=bearer(t.admin))
    assert res.status_code == 200, res.text
    return next(line for line in res.json()[kind] if line["item"] == item)
