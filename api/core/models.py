"""Normalized data model. Every number the app shows travels inside a Measurement,
so its source, age and kind (observed / model / interpolated ...) are never lost."""
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

Kind = Literal["observed", "model", "interpolated", "prediction", "derived", "static", "forecast"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Measurement(BaseModel):
    type: str                      # "sst", "wind_speed", "tide_height", ...
    value: float | str | None
    unit: str | None = None
    label: str | None = None       # plain-English line for fishermen
    kind: Kind
    source: str                    # "NOAA CoastWatch", "NWS", "NOAA CO-OPS 9410660" ...
    dataset: str | None = None
    observed_at: datetime | None = None
    forecast_for: datetime | None = None
    retrieved_at: datetime = Field(default_factory=utcnow)
    resolution_m: float | None = None
    distance_nm: float | None = None   # e.g. how far the tide station or buoy is from the tapped point
    extra: dict[str, Any] = Field(default_factory=dict)

    @property
    def age_hours(self) -> float | None:
        ref = self.observed_at or self.forecast_for
        return None if ref is None else (utcnow() - ref).total_seconds() / 3600


class Section(BaseModel):
    """One block of the conditions card. Errors are reported per section, never fatal."""
    ok: bool = True
    error: str | None = None
    items: list[Measurement] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)
