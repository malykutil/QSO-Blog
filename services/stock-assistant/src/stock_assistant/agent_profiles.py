HIGH_VOLATILITY_AGENT_SLUGS = frozenset({"momentum", "europe-momentum"})


def is_high_volatility_agent(slug: str) -> bool:
    return slug in HIGH_VOLATILITY_AGENT_SLUGS
