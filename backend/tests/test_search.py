from app.main import SearchRequest, catalog, is_compatible, search


def test_free_filter_only_returns_free_games():
    query = SearchRequest(prompt="competitive action", price="Free to play")
    assert all(game["free_to_play"] for game in catalog() if is_compatible(game, query))


def test_low_spec_filter_excludes_demanding_games():
    query = SearchRequest(prompt="adventure", ram_gb="4 GB", gpu_tier="Integrated")
    matches = [game for game in catalog() if is_compatible(game, query)]
    assert matches
    assert all(game["requirements"]["ram_gb"] <= 4 for game in matches)


def test_results_are_ordered_by_reviews_then_owners():
    results = search(SearchRequest(prompt="action"))["results"]
    ranking = [(game["positive_reviews"], game["estimated_owners"]) for game in results]
    assert ranking == sorted(ranking, reverse=True)
