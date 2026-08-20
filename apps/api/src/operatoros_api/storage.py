"""File storage seam (spec G.2: "Object storage (S3-compatible) for
attachments, receipts, and exports, served via signed URLs" -- not yet
built this phase, since no S3-compatible credentials exist in this
sandbox any more than the mobile-money/WhatsApp ones do). Same pattern as
`notifications.py`'s `NotificationSender` and `mobile_money.py`'s
`MobileMoneyProvider`: a real `Protocol` with one working implementation
(local disk) so a real S3-compatible backend is a later-phase seam-swap.

Used by `api/routers/expenses.py`'s receipt-photo upload (D.7.4): "the
upload and storage are real, OCR pre-fill is a documented no-op seam" --
this module is what makes "the upload and storage are real" true. Files
land under `<uploads_dir>/<business_id>/<random>-<original filename>` so
one tenant's uploads are namespaced away from another's even though this
phase has no signed-URL access control on top (a real S3 swap would add
that; local-disk storage in this sandbox is not itself a distribution
mechanism -- nothing serves these files back over HTTP this phase, only
the path/URL reference is stored and returned).
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Protocol

from operatoros_api.config import get_settings


class FileStorage(Protocol):
    async def save(self, *, business_id: str, filename: str, content: bytes) -> str:
        """Returns a URL/path reference to the stored file."""
        ...


class LocalDiskStorage:
    def __init__(self, base_dir: str | None = None) -> None:
        self.base_dir = Path(base_dir or get_settings().uploads_dir)

    async def save(self, *, business_id: str, filename: str, content: bytes) -> str:
        safe_name = f"{uuid.uuid4().hex}-{Path(filename).name}"
        dir_path = self.base_dir / business_id
        dir_path.mkdir(parents=True, exist_ok=True)
        file_path = dir_path / safe_name
        file_path.write_bytes(content)
        return f"/uploads/{business_id}/{safe_name}"


_storage: FileStorage = LocalDiskStorage()


def get_file_storage() -> FileStorage:
    return _storage
