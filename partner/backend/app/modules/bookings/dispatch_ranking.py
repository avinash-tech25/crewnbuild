"""The ranking engine: which eligible technicians are offered a booking first.

Pure functions, no I/O: given the metrics of each candidate it returns them in
order with a score and the breakdown behind it. Deterministic -- ties are broken
by distance, then by technician id -- and never random.

Every metric is normalised to 0..1 (1 = best) before weighting, and the weights
(DISPATCH_WEIGHT_*) are normalised by their sum:

    proximity     1 - distance / search radius       (or travel time / time to cross
                                                       the radius, when an ETA provider
                                                       answered for every candidate)
    rating        Bayesian average of stars, mapped 1..5 -> 0..1
    availability  how fresh and how precise the position is
    acceptance    accepted / answered offers           (Bayesian)
    completion    completed / (completed + handed back) (Bayesian)
    cancellation  1 - handed back / accepted            (Bayesian)
    experience    years, capped
    fairness      1 - jobs already accepted today / daily cap

Bayesian smoothing treats every technician as if they had DISPATCH_PRIOR_WEIGHT
earlier events at a neutral rate, so a newcomer is neither punished for having
no history nor crowned by one five-star job.

With the default weights a 200 m difference within a 5 km radius is worth
0.3 * 0.04 = 0.012 -- far less than the gap between a 2-star and a 4.5-star
technician -- so nobody wins merely by standing slightly closer.
"""

import uuid
from dataclasses import dataclass, field

from app.core.config import Settings


@dataclass(frozen=True)
class CandidateMetrics:
    technician_id: uuid.UUID
    distance_meters: float
    eta_seconds: float | None = None
    rating_average: float | None = None
    rating_count: int = 0
    offers_answered: int = 0
    offers_accepted: int = 0
    jobs_completed: int = 0
    jobs_handed_back: int = 0
    experience_years: int = 0
    jobs_today: int = 0
    location_age_seconds: float = 0.0
    location_accuracy_meters: float | None = None


@dataclass(frozen=True)
class RankingConfig:
    weights: dict[str, float]
    experience_cap_years: int
    fairness_daily_cap: int
    prior_weight: float
    rating_prior: float
    stale_threshold_seconds: float
    max_accuracy_meters: float
    fallback_speed_mps: float

    @classmethod
    def from_settings(cls, settings: Settings) -> "RankingConfig":
        raw = {
            "distance": settings.dispatch_weight_distance,
            "rating": settings.dispatch_weight_rating,
            "availability": settings.dispatch_weight_availability,
            "acceptance": settings.dispatch_weight_acceptance,
            "completion": settings.dispatch_weight_completion,
            "cancellation": settings.dispatch_weight_cancellation,
            "experience": settings.dispatch_weight_experience,
            "fairness": settings.dispatch_weight_fairness,
        }
        total = sum(raw.values())
        return cls(
            weights={name: value / total for name, value in raw.items()},
            experience_cap_years=max(settings.dispatch_experience_cap_years, 1),
            fairness_daily_cap=max(settings.dispatch_fairness_daily_cap, 1),
            prior_weight=max(settings.dispatch_prior_weight, 0.0),
            rating_prior=min(max(settings.dispatch_rating_prior, 1.0), 5.0),
            stale_threshold_seconds=max(settings.location_stale_threshold_seconds, 1),
            max_accuracy_meters=max(settings.max_location_accuracy_meters, 1.0),
            fallback_speed_mps=max(settings.tracking_fallback_speed_kmph, 1.0) / 3.6,
        )


@dataclass(frozen=True)
class RankedCandidate:
    technician_id: uuid.UUID
    rank: int
    score: float
    distance_meters: float
    eta_seconds: float | None
    breakdown: dict = field(default_factory=dict)


# Neutral rates a technician with no history is assumed to have.
PRIOR_ACCEPTANCE = 0.8
PRIOR_COMPLETION = 0.9
PRIOR_HAND_BACK = 0.05
# Accuracy at or under which a fix counts as fully precise.
PRECISE_ACCURACY_METERS = 20.0


def _clamp(value: float) -> float:
    return 0.0 if value < 0 else 1.0 if value > 1 else value


def _smoothed(successes: float, trials: float, prior: float, weight: float) -> float:
    return (successes + prior * weight) / (trials + weight) if trials + weight > 0 else prior


def _availability(metrics: CandidateMetrics, config: RankingConfig) -> float:
    freshness = 1.0 - _clamp(metrics.location_age_seconds / config.stale_threshold_seconds)
    accuracy = metrics.location_accuracy_meters
    if accuracy is None:
        precision = 0.5  # the device did not say: neither rewarded nor punished
    elif accuracy <= PRECISE_ACCURACY_METERS:
        precision = 1.0
    else:
        precision = 1.0 - _clamp(
            (accuracy - PRECISE_ACCURACY_METERS) / (config.max_accuracy_meters - PRECISE_ACCURACY_METERS)
        )
    return 0.6 * freshness + 0.4 * precision


def score_candidate(
    metrics: CandidateMetrics, *, radius_meters: float, use_eta: bool, config: RankingConfig
) -> tuple[float, dict]:
    radius = max(radius_meters, 1.0)
    if use_eta and metrics.eta_seconds is not None:
        horizon = radius / config.fallback_speed_mps
        proximity = 1.0 - _clamp(metrics.eta_seconds / horizon)
    else:
        proximity = 1.0 - _clamp(metrics.distance_meters / radius)

    weight = config.prior_weight
    rating_mean = _smoothed(
        (metrics.rating_average or 0.0) * metrics.rating_count, metrics.rating_count, config.rating_prior, weight
    )
    values = {
        "distance": proximity,
        "rating": _clamp((rating_mean - 1.0) / 4.0),
        "availability": _availability(metrics, config),
        "acceptance": _clamp(_smoothed(metrics.offers_accepted, metrics.offers_answered, PRIOR_ACCEPTANCE, weight)),
        "completion": _clamp(
            _smoothed(
                metrics.jobs_completed,
                metrics.jobs_completed + metrics.jobs_handed_back,
                PRIOR_COMPLETION,
                weight,
            )
        ),
        "cancellation": 1.0
        - _clamp(
            _smoothed(
                metrics.jobs_handed_back,
                metrics.offers_accepted,
                PRIOR_HAND_BACK,
                weight,
            )
        ),
        "experience": _clamp(metrics.experience_years / config.experience_cap_years),
        "fairness": 1.0 - _clamp(metrics.jobs_today / config.fairness_daily_cap),
    }
    score = sum(values[name] * config.weights[name] for name in values)
    breakdown = {
        "scores": {name: round(value, 4) for name, value in values.items()},
        "weights": {name: round(value, 4) for name, value in config.weights.items()},
        "inputs": {
            "distance_meters": round(metrics.distance_meters, 1),
            "eta_seconds": round(metrics.eta_seconds, 1) if metrics.eta_seconds is not None else None,
            "proximity_basis": "eta" if use_eta and metrics.eta_seconds is not None else "straight_line_distance",
            "radius_meters": round(radius, 1),
            "rating_average": metrics.rating_average,
            "rating_count": metrics.rating_count,
            "offers_answered": metrics.offers_answered,
            "offers_accepted": metrics.offers_accepted,
            "jobs_completed": metrics.jobs_completed,
            "jobs_handed_back": metrics.jobs_handed_back,
            "experience_years": metrics.experience_years,
            "jobs_today": metrics.jobs_today,
            "location_age_seconds": round(metrics.location_age_seconds, 1),
            "location_accuracy_meters": metrics.location_accuracy_meters,
        },
    }
    return score, breakdown


def rank_candidates(
    candidates: list[CandidateMetrics], *, radius_meters: float, config: RankingConfig
) -> list[RankedCandidate]:
    """Best first. ETA is used for proximity only if every candidate has one."""
    use_eta = bool(candidates) and all(candidate.eta_seconds is not None for candidate in candidates)
    scored = []
    for candidate in candidates:
        score, breakdown = score_candidate(candidate, radius_meters=radius_meters, use_eta=use_eta, config=config)
        scored.append((candidate, round(score, 6), breakdown))
    scored.sort(key=lambda entry: (-entry[1], entry[0].distance_meters, str(entry[0].technician_id)))
    return [
        RankedCandidate(
            technician_id=candidate.technician_id,
            rank=position,
            score=score,
            distance_meters=candidate.distance_meters,
            eta_seconds=candidate.eta_seconds if use_eta else None,
            breakdown=breakdown,
        )
        for position, (candidate, score, breakdown) in enumerate(scored, start=1)
    ]
