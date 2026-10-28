from httpx import AsyncClient

from tests.conftest import bearer, create_company, create_user, login_new_user, signup


async def test_super_admin_creates_and_edits_companies(client: AsyncClient) -> None:
    token = (await signup(client))["access_token"]
    company = await create_company(client, token, code="mr")
    assert company["code"] == "MR"
    assert "gstin" not in company

    res = await client.patch(
        f"/companies/{company['id']}",
        json={"name": "Michy Rubbers"},
        headers=bearer(token),
    )
    assert res.status_code == 200
    assert res.json()["name"] == "Michy Rubbers"

    listed = await client.get("/companies", headers=bearer(token))
    assert [c["code"] for c in listed.json()] == ["MR"]


async def test_company_code_is_unique_per_account(client: AsyncClient) -> None:
    token = (await signup(client))["access_token"]
    await create_company(client, token, code="MR")
    dup = await client.post(
        "/companies",
        json={"code": "mr", "name": "Again", "category": "crumb"},
        headers=bearer(token),
    )
    assert dup.status_code == 409
    # Another organisation may use the same code.
    other = (await signup(client, email="other@example.com"))["access_token"]
    await create_company(client, other, code="MR")


async def test_company_input_is_validated(client: AsyncClient) -> None:
    token = (await signup(client))["access_token"]
    for body in (
        {"code": "M R", "name": "x", "category": "crumb"},
        {"code": "MR", "name": "", "category": "crumb"},
        {"code": "MR", "name": "x"},  # no company type
        {"code": "MR", "name": "x", "category": "bakery"},
    ):
        res = await client.post("/companies", json=body, headers=bearer(token))
        assert res.status_code == 422, body


async def test_companies_of_other_accounts_are_invisible(client: AsyncClient) -> None:
    mine = (await signup(client))["access_token"]
    theirs = (await signup(client, email="other@example.com"))["access_token"]
    their_company = await create_company(client, theirs, code="XX")

    url = f"/companies/{their_company['id']}"
    assert (await client.get(url, headers=bearer(mine))).status_code == 404
    patch = await client.patch(url, json={"name": "hijacked"}, headers=bearer(mine))
    assert patch.status_code == 404
    assert (await client.get("/companies", headers=bearer(mine))).json() == []


async def test_members_see_only_their_companies(client: AsyncClient) -> None:
    admin = (await signup(client))["access_token"]
    a = await create_company(client, admin, code="A")
    b = await create_company(client, admin, code="B")
    created = await create_user(
        client,
        admin,
        "ops@example.com",
        memberships=[{"company_id": a["id"], "role": "operator", "duties": ["purchase"]}],
    )
    ops = await login_new_user(client, created)

    assert [c["code"] for c in (await client.get("/companies", headers=bearer(ops))).json()] == [
        "A"
    ]
    assert (await client.get(f"/companies/{a['id']}", headers=bearer(ops))).status_code == 200
    assert (await client.get(f"/companies/{b['id']}", headers=bearer(ops))).status_code == 404
    # Only the Super Admin manages companies.
    assert (
        await client.post(
            "/companies", json={"code": "C", "name": "C", "category": "crumb"}, headers=bearer(ops)
        )
    ).status_code == 403

    me = (await client.get("/auth/me", headers=bearer(ops))).json()
    assert me["system_permissions"] == []
    [access] = me["companies"]
    assert access["role"] == "operator"
    assert access["duties"] == ["purchase"]
    assert sorted(access["permissions"]) == [
        "comment_entry",
        "enter_purchase",
        "view",
        "view_stock",
    ]


async def test_ceo_sees_every_active_company_read_only(client: AsyncClient) -> None:
    admin = (await signup(client))["access_token"]
    await create_company(client, admin, code="A")
    closed = await create_company(client, admin, code="Z")
    await client.patch(
        f"/companies/{closed['id']}", json={"is_active": False}, headers=bearer(admin)
    )

    ceo = await login_new_user(
        client, await create_user(client, admin, "ceo@example.com", global_role="ceo")
    )
    me = (await client.get("/auth/me", headers=bearer(ceo))).json()
    assert [c["company"]["code"] for c in me["companies"]] == ["A"]
    assert sorted(me["companies"][0]["permissions"]) == [
        "view",
        "view_all_entries",
        "view_finance",
        "view_oil_kpi",
        "view_stock",
    ]
    assert (await client.get(f"/companies/{closed['id']}", headers=bearer(ceo))).status_code == 404

    # The Super Admin still sees the closed company so it can be re-opened.
    codes = [c["code"] for c in (await client.get("/companies", headers=bearer(admin))).json()]
    assert codes == ["A", "Z"]


async def test_company_audit_log_needs_the_manager(client: AsyncClient) -> None:
    admin = (await signup(client))["access_token"]
    a = await create_company(client, admin, code="A")
    member = lambda role: [{"company_id": a["id"], "role": role}]  # noqa: E731
    company_admin = await login_new_user(
        client, await create_user(client, admin, "mgr@example.com", memberships=member("manager"))
    )
    finance = await login_new_user(
        client, await create_user(client, admin, "fin@example.com", memberships=member("finance"))
    )
    url = f"/companies/{a['id']}/audit-logs"
    ok = await client.get(url, headers=bearer(company_admin))
    assert ok.status_code == 200
    assert ok.json()["items"][0]["action"] == "company_created"
    assert (await client.get(url, headers=bearer(finance))).status_code == 403
