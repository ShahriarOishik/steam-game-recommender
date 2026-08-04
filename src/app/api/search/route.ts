import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Tier = "Integrated" | "Entry" | "Mid-range" | "High-end";
type SearchBody = { prompt?: string; os?: string; ram_gb?: string; cpu_tier?: string; gpu_tier?: string; storage_gb?: string; genre?: string; price?: string; limit?: number };
type Requirements = { os: string; ram_gb: number; cpu_tier: Tier; gpu_tier: Tier; storage_gb: number };
type Game = { app_id: number; title: string; genres: string[]; positive_reviews: number; estimated_owners: number; free_to_play: boolean; steam_url: string; description: string; header_image: string; requirements: Requirements; match_score: number };
type QdrantPoint = { score?: number; payload?: Record<string, unknown> };

const collection = "steam_games";
const tiers: Record<Tier, number> = { Integrated: 0, Entry: 1, "Mid-range": 2, "High-end": 3 };

function numberFromChoice(value: string | undefined) {
  const match = value?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function compatible(game: Game, query: Required<Omit<SearchBody, "limit">>) {
  const specs = game.requirements;
  const ram = numberFromChoice(query.ram_gb), storage = numberFromChoice(query.storage_gb);
  if (query.os !== "Any OS" && !specs.os.toLowerCase().includes(query.os.toLowerCase())) return false;
  if (ram !== undefined && specs.ram_gb > ram) return false;
  if (storage !== undefined && specs.storage_gb > storage) return false;
  if (query.cpu_tier !== "Any CPU" && tiers[specs.cpu_tier] > tiers[query.cpu_tier as Tier]) return false;
  if (query.gpu_tier !== "Any GPU" && tiers[specs.gpu_tier] > tiers[query.gpu_tier as Tier]) return false;
  if (query.genre !== "Any genre" && !game.genres.some((genre) => genre.toLowerCase() === query.genre.toLowerCase())) return false;
  if (query.price === "Free to play" && !game.free_to_play) return false;
  return !(query.price === "Paid" && game.free_to_play);
}

async function promptEmbedding(prompt: string) {
  const token = process.env.HUGGINGFACE_API_TOKEN;
  if (!token) throw new Error("HUGGINGFACE_API_TOKEN is not configured.");
  const response = await fetch("https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ inputs: prompt, options: { wait_for_model: true } }) });
  if (!response.ok) throw new Error("The embedding service could not process this prompt.");
  const data = await response.json() as number[] | number[][];
  const vector = Array.isArray(data[0])
    ? (data as number[][]).reduce((mean, token) => mean.map((value, index) => value + token[index] / data.length), new Array<number>((data as number[][])[0].length).fill(0))
    : data as number[];
  const magnitude = Math.hypot(...vector);
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

async function qdrantRequest(path: string, body: object) {
  const url = process.env.QDRANT_URL?.replace(/\/$/, ""), apiKey = process.env.QDRANT_API_KEY;
  if (!url || !apiKey) throw new Error("QDRANT_URL and QDRANT_API_KEY must be configured.");
  const response = await fetch(`${url}${path}`, { method: "POST", headers: { "api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (!response.ok) throw new Error("The vector database is unavailable. Verify the Qdrant collection and credentials.");
  return response.json() as Promise<{ result?: { points?: QdrantPoint[]; next_page_offset?: unknown } }>;
}

function toGame(point: QdrantPoint): Game | null {
  const payload = point.payload;
  if (!payload || typeof payload.app_id !== "number" || typeof payload.title !== "string" || !Array.isArray(payload.genres) || !payload.requirements) return null;
  const requirements = payload.requirements as Requirements;
  if (typeof requirements.ram_gb !== "number" || typeof requirements.storage_gb !== "number") return null;
  return { app_id: payload.app_id, title: payload.title, genres: payload.genres.filter((genre): genre is string => typeof genre === "string"), positive_reviews: Number(payload.positive_reviews) || 0, estimated_owners: Number(payload.estimated_owners) || 0, free_to_play: Boolean(payload.free_to_play), steam_url: String(payload.steam_url ?? `https://store.steampowered.com/app/${payload.app_id}/`), description: String(payload.description ?? ""), header_image: String(payload.header_image ?? ""), requirements, match_score: point.score ?? 0 };
}

export async function POST(request: Request) {
  let body: SearchBody;
  try { body = await request.json() as SearchBody; } catch { return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 }); }
  const query = { prompt: body.prompt?.trim() ?? "", os: body.os ?? "Any OS", ram_gb: body.ram_gb ?? "Any RAM", cpu_tier: body.cpu_tier ?? "Any CPU", gpu_tier: body.gpu_tier ?? "Any GPU", storage_gb: body.storage_gb ?? "Any storage", genre: body.genre ?? "Any genre", price: body.price ?? "Any price" };

  try {
    const result = query.prompt
      ? await qdrantRequest(`/collections/${collection}/points/query`, { query: await promptEmbedding(query.prompt), limit: 500, with_payload: true, with_vector: false })
      : await qdrantRequest(`/collections/${collection}/points/scroll`, { limit: 500, with_payload: true, with_vector: false, order_by: { key: "positive_reviews", direction: "desc" } });
    const matches = (result.result?.points ?? []).map(toGame).filter((game): game is Game => game !== null).filter((game) => compatible(game, query)).sort((left, right) => right.positive_reviews - left.positive_reviews || right.estimated_owners - left.estimated_owners || right.match_score - left.match_score);
    const results = matches.slice(0, Math.min(Math.max(body.limit ?? 20, 1), 50));
    return NextResponse.json({ results, total: matches.length, search_mode: query.prompt ? "80k Steam MiniLM vector search" : "80k Steam popularity browse" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Recommendation search failed.";
    return NextResponse.json({ detail }, { status: 503 });
  }
}
