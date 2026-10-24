from httpx import AsyncClient


async def test_health_ok(client: AsyncClient) -> None:
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["x-content-type-options"] == "nosniff"


async def test_docs_disabled_outside_development(client: AsyncClient) -> None:
    assert (await client.get("/docs")).status_code == 404
    assert (await client.get("/openapi.json")).status_code == 404
