from httpx import AsyncClient

from tests.conftest import bearer, create_company, create_user, login_new_user, signup


async def _setup(client: AsyncClient) -> tuple[str, dict, dict]:
    admin = (await signup(client))["access_token"]
    a = await create_company(client, admin, code="A")
    b = await create_company(client, admin, code="B")
    return admin, a, b


async def test_new_user_must_change_temporary_password(client: AsyncClient) -> None:
    admin, a, _ = await _setup(client)
    created = await create_user(
        client, admin, "Ops@Example.com", memberships=[{"company_id": a["id"], "role": "manager"}]
    )
    assert created["user"]["email"] == "ops@example.com"
    assert created["user"]["must_change_password"] is True
    assert len(created["temporary_password"]) >= 12

    res = await client.post(
        "/auth/login", json={"email": "ops@example.com", "password": created["temporary_password"]}
    )
    token = res.json()["access_token"]
    # Everything except /auth/me and change-password is blocked until a new password is set.
    blocked = await client.get("/companies", headers=bearer(token))
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "password_change_required"
    assert (await client.get("/auth/me", headers=bearer(token))).status_code == 200

    fresh = await login_new_user(client, created)
    assert (await client.get("/companies", headers=bearer(fresh))).status_code == 200


async def test_access_must_be_global_or_company(client: AsyncClient) -> None:
    admin, a, _ = await _setup(client)
    both = {"global_role": "ceo", "memberships": [{"company_id": a["id"], "role": "manager"}]}
    cases = [
        {},  # neither
        both,
        {"memberships": [{"company_id": a["id"], "role": "operator", "duties": []}]},
        {"memberships": [{"company_id": a["id"], "role": "manager"}] * 2},
        {"memberships": [{"company_id": a["id"], "role": "owner"}]},
    ]
    for access in cases:
        body = {"email": "x@example.com", "full_name": "X", **access}
        res = await client.post("/users", json=body, headers=bearer(admin))
        assert res.status_code == 422, access


async def test_cannot_grant_companies_of_another_account(client: AsyncClient) -> None:
    admin, _, _ = await _setup(client)
    other = (await signup(client, email="other@example.com"))["access_token"]
    foreign = await create_company(client, other, code="X")
    res = await client.post(
        "/users",
        json={
            "email": "x@example.com",
            "full_name": "X",
            "memberships": [{"company_id": foreign["id"], "role": "manager"}],
        },
        headers=bearer(admin),
    )
    assert res.status_code == 400
    assert res.json()["code"] == "unknown_company"


async def test_duplicate_email_conflicts(client: AsyncClient) -> None:
    admin, _, _ = await _setup(client)
    res = await client.post(
        "/users",
        json={"email": "PRIYA@example.com", "full_name": "Dup", "global_role": "ceo"},
        headers=bearer(admin),
    )
    assert res.status_code == 409


async def test_multi_company_membership_with_different_roles(client: AsyncClient) -> None:
    admin, a, b = await _setup(client)
    created = await create_user(
        client,
        admin,
        "multi@example.com",
        memberships=[
            {"company_id": a["id"], "role": "finance", "duties": ["purchase"]},
            {"company_id": b["id"], "role": "operator", "duties": ["sales", "sales"]},
        ],
    )
    roles = {m["company"]["code"]: (m["role"], m["duties"]) for m in created["user"]["memberships"]}
    # Duties are dropped for non-operators and de-duplicated for operators.
    assert roles == {"A": ("finance", []), "B": ("operator", ["sales"])}

    token = await login_new_user(client, created)
    me = (await client.get("/auth/me", headers=bearer(token))).json()
    perms = {c["company"]["code"]: set(c["permissions"]) for c in me["companies"]}
    assert perms["A"] == {
        "view",
        "view_all_entries",
        "view_stock",
        "comment_entry",
        "verify_entry",
        "view_finance",
    }
    assert perms["B"] == {"view", "view_stock", "comment_entry", "enter_sales"}


async def test_changing_access_takes_effect_immediately(client: AsyncClient) -> None:
    admin, a, b = await _setup(client)
    created = await create_user(
        client, admin, "ops@example.com", memberships=[{"company_id": a["id"], "role": "manager"}]
    )
    token = await login_new_user(client, created)
    user_id = created["user"]["id"]

    res = await client.put(
        f"/users/{user_id}/access",
        json={"memberships": [{"company_id": b["id"], "role": "manager"}]},
        headers=bearer(admin),
    )
    assert res.status_code == 200
    assert [m["company"]["code"] for m in res.json()["memberships"]] == ["B"]
    # The old token no longer works, so stale access cannot linger.
    assert (await client.get("/auth/me", headers=bearer(token))).status_code == 401


async def test_deactivated_user_is_signed_out(client: AsyncClient) -> None:
    admin, _, _ = await _setup(client)
    created = await create_user(client, admin, "ceo@example.com", global_role="ceo")
    token = await login_new_user(client, created)
    res = await client.patch(
        f"/users/{created['user']['id']}", json={"is_active": False}, headers=bearer(admin)
    )
    assert res.status_code == 200
    assert (await client.get("/auth/me", headers=bearer(token))).status_code == 401
    login = await client.post(
        "/auth/login", json={"email": "ceo@example.com", "password": "a-proper-password"}
    )
    assert login.status_code == 401


async def test_super_admin_cannot_lock_themselves_out(client: AsyncClient) -> None:
    data = await signup(client)
    admin, me = data["access_token"], data["user"]["id"]
    deactivate = await client.patch(
        f"/users/{me}", json={"is_active": False}, headers=bearer(admin)
    )
    assert deactivate.status_code == 403
    demote = await client.put(
        f"/users/{me}/access", json={"global_role": "ceo"}, headers=bearer(admin)
    )
    assert demote.status_code == 403
    reset = await client.post(f"/users/{me}/reset-password", headers=bearer(admin))
    assert reset.status_code == 403


async def test_super_admin_can_demote_another_super_admin(client: AsyncClient) -> None:
    admin = (await signup(client))["access_token"]
    second = await create_user(client, admin, "second@example.com", global_role="super_admin")
    second_token = await login_new_user(client, second)
    first_id = (await client.get("/auth/me", headers=bearer(admin))).json()["id"]

    res = await client.put(
        f"/users/{first_id}/access", json={"global_role": "ceo"}, headers=bearer(second_token)
    )
    assert res.status_code == 200
    assert res.json()["global_role"] == "ceo"
    # The demoted person is signed out and, once back in, can no longer manage users.
    assert (await client.get("/auth/me", headers=bearer(admin))).status_code == 401


async def test_reset_password_issues_new_temporary_password(client: AsyncClient) -> None:
    admin, _, _ = await _setup(client)
    created = await create_user(client, admin, "ceo@example.com", global_role="ceo")
    token = await login_new_user(client, created)
    res = await client.post(f"/users/{created['user']['id']}/reset-password", headers=bearer(admin))
    assert res.status_code == 200
    assert res.json()["user"]["must_change_password"] is True
    assert (await client.get("/auth/me", headers=bearer(token))).status_code == 401
    again = await login_new_user(client, res.json())
    assert (await client.get("/companies", headers=bearer(again))).status_code == 200


async def test_only_super_admin_manages_users(client: AsyncClient) -> None:
    admin, a, _ = await _setup(client)
    company_admin = await login_new_user(
        client,
        await create_user(
            client,
            admin,
            "adm@example.com",
            memberships=[{"company_id": a["id"], "role": "manager"}],
        ),
    )
    assert (await client.get("/users", headers=bearer(company_admin))).status_code == 403
    res = await client.post(
        "/users",
        json={"email": "x@example.com", "full_name": "X", "global_role": "super_admin"},
        headers=bearer(company_admin),
    )
    assert res.status_code == 403
    assert (await client.get("/audit-logs", headers=bearer(company_admin))).status_code == 403


async def test_user_actions_are_audited(client: AsyncClient) -> None:
    admin, a, _ = await _setup(client)
    created = await create_user(client, admin, "ceo@example.com", global_role="ceo")
    await client.post(f"/users/{created['user']['id']}/reset-password", headers=bearer(admin))
    logs = (await client.get("/audit-logs?entity_type=user", headers=bearer(admin))).json()
    actions = [i["action"] for i in logs["items"]]
    assert actions[:2] == ["password_reset", "user_created"]
    assert logs["items"][0]["actor_name"] == "Priya Sundar"
    # Temporary passwords are never written to the log.
    assert created["temporary_password"] not in str(logs)


async def test_the_admin_role_cannot_be_given(client: AsyncClient) -> None:
    admin, a, _ = await _setup(client)
    res = await client.post(
        "/users",
        json={
            "email": "x@example.com",
            "full_name": "X",
            "memberships": [{"company_id": a["id"], "role": "admin"}],
        },
        headers=bearer(admin),
    )
    assert res.status_code == 422
