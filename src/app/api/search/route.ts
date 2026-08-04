import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Tier = "Integrated" | "Entry" | "Mid-range" | "High-end";
type SearchBody = { prompt?: string; os?: string; ram_gb?: string; cpu_tier?: string; gpu_tier?: string; storage_gb?: string; genre?: string; price?: string; limit?: number };
type SteamSearchItem = { id: number; type: string | number };
type SteamDetails = { type?: string; name?: string; is_free?: boolean; short_description?: string; detailed_description?: string; header_image?: string; pc_requirements?: { minimum?: string }; platforms?: { windows?: boolean; mac?: boolean; linux?: boolean }; genres?: { description: string }[]; categories?: { description: string }[]; recommendations?: { total?: number } };
type SteamSpy = { positive?: number; owners?: string; tags?: Record<string, number> };
type Game = { app_id: number; title: string; genres: string[]; positive_reviews: number; estimated_owners: number; free_to_play: boolean; steam_url: string; description: string; header_image: string; requirements: { os: string; ram_gb: number; cpu_tier: Tier; gpu_tier: Tier; storage_gb: number }; match_score: number };

const dimensions = 384;
const tiers: Record<Tier, number> = { Integrated: 0, Entry: 1, "Mid-range": 2, "High-end": 3 };
const ignoredWords = new Set(["a", "an", "and", "best", "can", "find", "for", "game", "games", "give", "i", "me", "my", "of", "please", "recommend", "recommendation", "show", "suggest", "the", "to", "want", "with"]);

function normalizedWords(text: string) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map((word) => {
    if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
    if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
    if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
    if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
    return word;
  }).filter((word) => word.length > 2 && !ignoredWords.has(word));
}

function embedding(text: string) {
  const vector = new Float32Array(dimensions);
  for (const word of normalizedWords(text)) {
    let hash = 2166136261;
    for (const character of word) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    vector[(hash >>> 0) % dimensions] += 1;
  }
  const magnitude = Math.hypot(...vector);
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

function cosineSimilarity(left: Float32Array, right: Float32Array) { return left.reduce((sum, value, index) => sum + value * right[index], 0); }
function cleanText(value = "") { return value.replace(/<[^>]+>/g, " ").replace(/&[^;\s]+;/g, " ").replace(/\s+/g, " ").trim(); }
function numberFromChoice(value: string | undefined) { const match = value?.match(/\d+/); return match ? Number(match[0]) : undefined; }

function requirementNumber(requirements: string, label: "memory" | "storage", fallback: number) {
  const line = requirements.match(new RegExp(`${label}[\\s\\S]{0,100}?(\\d+(?:\\.\\d+)?)\\s*(gb|mb)`, "i"));
  if (!line) return fallback;
  const value = Number(line[1]);
  return line[2].toLowerCase() === "mb" ? Math.max(1, Math.ceil(value / 1024)) : Math.ceil(value);
}

function hardwareTier(requirements: string, kind: "cpu" | "gpu"): Tier {
  const value = requirements.toLowerCase();
  if (kind === "gpu" && /(intel hd|intel uhd|integrated|onboard)/.test(value)) return "Integrated";
  if (/(rtx|rx [6-9]|gtx 10|gtx 16|i7|i9|ryzen 7|ryzen 9)/.test(value)) return "High-end";
  if (/(gtx|radeon|geforce|i5|ryzen 5)/.test(value)) return "Mid-range";
  return "Entry";
}

async function getJson<T>(url: string): Promise<T | null> {
  try { const response = await fetch(url, { next: { revalidate: 900 }, headers: { "User-Agent": "SpecScout/1.0" } }); return response.ok ? await response.json() as T : null; } catch { return null; }
}

async function candidateIds(prompt: string) {
  if (prompt.trim()) {
    const search = await getJson<{ items?: SteamSearchItem[] }>(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(prompt)}&cc=us&l=en`);
    return (search?.items ?? []).filter((item) => item.type === "app").slice(0, 18).map((item) => item.id);
  }
  const featured = await getJson<{ top_sellers?: { items?: SteamSearchItem[] }; specials?: { items?: SteamSearchItem[] }; new_releases?: { items?: SteamSearchItem[] } }>("https://store.steampowered.com/api/featuredcategories?cc=us&l=en");
  return [...(featured?.top_sellers?.items ?? []), ...(featured?.specials?.items ?? []), ...(featured?.new_releases?.items ?? [])].filter((item) => item.type === "app" || item.type === 0).map((item) => item.id).filter((id, index, values) => values.indexOf(id) === index).slice(0, 18);
}

async function loadGame(appId: number, queryVector: Float32Array): Promise<Game | null> {
  const [detailsResponse, steamSpy] = await Promise.all([getJson<Record<string, { success: boolean; data?: SteamDetails }>>(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`), getJson<SteamSpy>(`https://steamspy.com/api.php?request=appdetails&appid=${appId}`)]);
  const details = detailsResponse?.[String(appId)]?.data;
  if (!details || details.type !== "game" || !details.name) return null;
  const requirementsText = cleanText(details.pc_requirements?.minimum);
  const genres = [...(details.genres ?? []).map((genre) => genre.description), ...(details.categories ?? []).map((category) => category.description), ...Object.keys(steamSpy?.tags ?? {}).slice(0, 12)].filter((value, index, values) => values.indexOf(value) === index);
  const description = cleanText(details.detailed_description || details.short_description).slice(0, 1400);
  const os = [details.platforms?.windows && "Windows", details.platforms?.mac && "macOS", details.platforms?.linux && "Linux"].filter(Boolean).join(" ") || "Windows";
  const owners = Number((steamSpy?.owners ?? "0").split("..")[0].replace(/[^0-9]/g, ""));
  return { app_id: appId, title: details.name, genres, positive_reviews: steamSpy?.positive ?? details.recommendations?.total ?? 0, estimated_owners: Number.isFinite(owners) ? owners : 0, free_to_play: Boolean(details.is_free), steam_url: `https://store.steampowered.com/app/${appId}/`, description, header_image: details.header_image ?? "", requirements: { os, ram_gb: requirementNumber(requirementsText, "memory", 8), cpu_tier: hardwareTier(requirementsText, "cpu"), gpu_tier: hardwareTier(requirementsText, "gpu"), storage_gb: requirementNumber(requirementsText, "storage", 30) }, match_score: cosineSimilarity(queryVector, embedding(`${details.name} ${description} ${genres.join(" ")}`)) };
}

function compatible(game: Game, query: Required<Omit<SearchBody, "limit">>) {
  const specs = game.requirements, ram = numberFromChoice(query.ram_gb), storage = numberFromChoice(query.storage_gb);
  if (query.os !== "Any OS" && !specs.os.toLowerCase().includes(query.os.toLowerCase())) return false;
  if (ram !== undefined && specs.ram_gb > ram) return false;
  if (storage !== undefined && specs.storage_gb > storage) return false;
  if (query.cpu_tier !== "Any CPU" && tiers[specs.cpu_tier] > tiers[query.cpu_tier as Tier]) return false;
  if (query.gpu_tier !== "Any GPU" && tiers[specs.gpu_tier] > tiers[query.gpu_tier as Tier]) return false;
  if (query.genre !== "Any genre" && !game.genres.some((genre) => genre.toLowerCase() === query.genre.toLowerCase())) return false;
  if (query.price === "Free to play" && !game.free_to_play) return false;
  return !(query.price === "Paid" && game.free_to_play);
}

export async function POST(request: Request) {
  let body: SearchBody;
  try { body = await request.json() as SearchBody; } catch { return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 }); }
  const query = { prompt: body.prompt?.trim() ?? "", os: body.os ?? "Any OS", ram_gb: body.ram_gb ?? "Any RAM", cpu_tier: body.cpu_tier ?? "Any CPU", gpu_tier: body.gpu_tier ?? "Any GPU", storage_gb: body.storage_gb ?? "Any storage", genre: body.genre ?? "Any genre", price: body.price ?? "Any price" };
  const ids = await candidateIds(query.prompt);
  if (!ids.length) return NextResponse.json({ detail: "Steam did not return games for this search. Try a different prompt." }, { status: 502 });
  const queryVector = embedding(query.prompt);
  const games = (await Promise.all(ids.map((id) => loadGame(id, queryVector)))).filter((game): game is Game => game !== null);
  const matches = games.filter((game) => compatible(game, query) && (!query.prompt || game.match_score > 0)).sort((left, right) => right.positive_reviews - left.positive_reviews || right.estimated_owners - left.estimated_owners || right.match_score - left.match_score);
  const results = matches.slice(0, Math.min(Math.max(body.limit ?? 12, 1), 18));
  return NextResponse.json({ results, total: matches.length, search_mode: "Live Steam discovery + vector similarity" });
}
