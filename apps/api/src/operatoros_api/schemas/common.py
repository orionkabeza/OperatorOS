"""Base Pydantic model: every request/response body in the API inherits
this so `extra="forbid"` is never an opt-in someone forgets (spec G.1:
"Every request body validated against a schema with unknown fields
rejected. No exceptions.")."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
