import { NextResponse } from "next/server";
import catalog from "../../../../backend/data/games.json";

export const dynamic = "force-dynamic";

type Game = (typeof catalog)[number];
type Tier = "Integrated" | "Entry" | "Mid-range" | "High-end";
type SearchBody = {
  prompt?: string;
  os?: string;
  ram_gb?: string;
  cpu_tier?: string;
  gpu_tier?: string;
  storage_gb?: string;
  genre?: string;
  price?: string;
  limit?: number;
};

const tiers: Record<Tier, number> = { Integrated: 0, Entry: 1, "Mid-range": 2, "High-end": 3 };

function numberFromChoice(value: string | undefined) {
  const match = value?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function score(game: Game, prompt: string) {
  const words = new Set((prompt.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 2));
  const text = `${game.title} ${game.description} ${game.genres.join(" ")}`.toLowerCase();
  return [...words].filter((word) => text.includes(word)).length / Math.max(1, words.size);
}

function compatible(game: Game, query: Required<Omit<SearchBody, "limit">>) {
  const specs = game.requirements;
  const ram = numberFromChoice(query.ram_gb);
  const storage = numberFromChoice(query.storage_gb);
  if (query.os !== "Any OS" && !specs.os.toLowerCase().includes(query.os.toLowerCase())) return false;
  if (ram !== undefined && specs.ram_gb > ram) return false;
  if (storage !== undefined && specs.storage_gb > storage) return false;
  if (query.cpu_tier !== "Any CPU" && tiers[specs.cpu_tier as Tier] > tiers[query.cpu_tier as Tier]) return false;
  if (query.gpu_tier !== "Any GPU" && tiers[specs.gpu_tier as Tier] > tiers[query.gpu_tier as Tier]) return false;
  if (query.genre !== "Any genre" && !game.genres.some((genre) => genre.toLowerCase() === query.genre.toLowerCase())) return false;
  if (query.price === "Free to play" && !game.free_to_play) return false;
  return !(query.price === "Paid" && game.free_to_play);
}

export async function POST(request: Request) {
  const body = (await request.json()) as SearchBody;
  const query = {
    prompt: body.prompt?.trim() ?? "",
    os: body.os ?? "Any OS",
    ram_gb: body.ram_gb ?? "Any RAM",
    cpu_tier: body.cpu_tier ?? "Any CPU",
    gpu_tier: body.gpu_tier ?? "Any GPU",
    storage_gb: body.storage_gb ?? "Any storage",
    genre: body.genre ?? "Any genre",
    price: body.price ?? "Any price",
  };

  if (!query.prompt) return NextResponse.json({ detail: "A search prompt is required." }, { status: 400 });

  const results = catalog
    .map((game) => ({ ...game, match_score: score(game, query.prompt) }))
    .filter((game) => game.match_score > 0 && compatible(game, query))
    .sort((left, right) => right.positive_reviews - left.positive_reviews || right.estimated_owners - left.estimated_owners || right.match_score - left.match_score)
    .slice(0, Math.min(Math.max(body.limit ?? 12, 1), 50));

  return NextResponse.json({ results, total: results.length, search_mode: "Keyword recommendation search" });
}
