"""App home banners service tests."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

from bson import ObjectId

from services import app_home_banners_service as svc


def test_create_banner_strips_object_id():
    asyncio.run(_test_create_banner_strips_object_id())


async def _test_create_banner_strips_object_id():
    db = MagicMock()

    async def _insert_one(doc):
        doc["_id"] = ObjectId()

    stored = {}

    col = MagicMock()
    cur = MagicMock()
    cur.sort = MagicMock(return_value=cur)
    cur.to_list = AsyncMock(return_value=[])
    col.find = MagicMock(return_value=cur)

    async def _insert_one(doc):
        doc["_id"] = ObjectId()
        stored.update(doc)

    col.insert_one = AsyncMock(side_effect=_insert_one)
    col.find_one = AsyncMock(side_effect=lambda q, proj: {k: v for k, v in stored.items() if k != "_id"} if q.get("id") == stored.get("id") else None)

    def _getitem(name):
        assert name == svc.COL_BANNERS
        return col

    db.__getitem__ = MagicMock(side_effect=_getitem)

    out = await svc.create_banner(db, {"title": "Test promo", "enabled": True})
    assert out["title"] == "Test promo"
    assert "_id" not in out
    assert "id" in out
    assert not any(isinstance(v, ObjectId) for v in out.values())


if __name__ == "__main__":
    test_create_banner_strips_object_id()
    print("ok")
