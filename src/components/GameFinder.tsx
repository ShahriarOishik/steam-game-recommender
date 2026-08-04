"use client";

import { FormEvent, useState } from "react";

type Game = { app_id: number; title: string; genres: string[]; positive_reviews: number; estimated_owners: number; free_to_play: boolean; steam_url: string; description: string; requirements: { os: string; ram_gb: number; cpu_tier: string; gpu_tier: string; storage_gb: number } };
type SearchResponse = { results: Game[]; total: number; search_mode: string };

const options = {
  os: ["Any OS", "Windows", "macOS", "Linux"], ram_gb: ["Any RAM", "4 GB", "8 GB", "16 GB", "32 GB"], cpu_tier: ["Any CPU", "Entry", "Mid-range", "High-end"], gpu_tier: ["Any GPU", "Integrated", "Entry", "Mid-range", "High-end"], storage_gb: ["Any storage", "20 GB", "50 GB", "100 GB", "150 GB"], genre: ["Any genre", "Action", "Adventure", "RPG", "Strategy", "Simulation", "Indie"], price: ["Any price", "Free to play", "Paid"],
};
const initialFilters = { os: "Any OS", ram_gb: "Any RAM", cpu_tier: "Any CPU", gpu_tier: "Any GPU", storage_gb: "Any storage", genre: "Any genre", price: "Any price" };
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function GameFinder() {
  const [prompt, setPrompt] = useState("A cinematic fantasy adventure I can play on an 8 GB laptop");
  const [filters, setFilters] = useState(initialFilters);
  const [results, setResults] = useState<Game[]>([]);
  const [total, setTotal] = useState(0);
  const [mode, setMode] = useState("Ready to search");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  async function search(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setHasSearched(true);
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
      const response = await fetch(`${apiBaseUrl}/api/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, ...filters, limit: 12 }) });
      if (!response.ok) throw new Error("The recommendation service is unavailable.");
      const data: SearchResponse = await response.json(); setResults(data.results); setTotal(data.total); setMode(data.search_mode);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Search failed."); } finally { setLoading(false); }
  }

  return <main className="min-h-screen overflow-hidden bg-[#080b16] text-[#ecf4ff]">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[540px] bg-[radial-gradient(ellipse_at_20%_0%,rgba(66,101,255,.3),transparent_52%),radial-gradient(ellipse_at_86%_25%,rgba(157,255,115,.16),transparent_37%)]" />
    <section className="relative mx-auto max-w-7xl px-5 pb-16 pt-7 sm:px-8">
      <nav className="flex items-center justify-between border-b border-white/10 pb-5 text-sm"><div className="flex items-center gap-3 font-bold tracking-[0.18em]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#9dff73] text-[#080b16]">S</span> SPEC SCOUT</div><span className="text-[#9ba8c7]">Steam game finder</span></nav>
      <div className="max-w-4xl py-16 sm:py-24"><p className="mb-5 text-xs font-bold uppercase tracking-[0.28em] text-[#9dff73]">Find your next install</p><h1 className="max-w-3xl text-5xl font-semibold leading-[.96] tracking-tight sm:text-7xl">Your library should fit <span className="text-[#9dff73]">your rig.</span></h1><p className="mt-7 max-w-2xl text-lg leading-8 text-[#aeb9d3]">Describe what you want to play, set your PC limits, and discover Steam games ranked by positive reviews and estimated player ownership.</p></div>
      <form onSubmit={search} className="rounded-3xl border border-white/10 bg-[#10162a]/90 p-4 shadow-2xl shadow-black/30 backdrop-blur sm:p-6"><label className="mb-2 block text-sm font-semibold">What are you in the mood for?</label><div className="flex flex-col gap-3 md:flex-row"><input value={prompt} onChange={(event) => setPrompt(event.target.value)} required placeholder="e.g. tactical co-op horror with a clever story" className="h-14 min-w-0 flex-1 rounded-xl border border-white/10 bg-[#070a14] px-4 text-base outline-none placeholder:text-[#6f7a96] focus:border-[#9dff73]" /><button disabled={loading} className="h-14 rounded-xl bg-[#9dff73] px-7 font-bold text-[#080b16] transition hover:bg-[#bcffa0] disabled:cursor-wait disabled:opacity-60">{loading ? "Scanning..." : "Search games"}</button></div><div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">{Object.entries(options).map(([key, values]) => <label key={key} className="text-xs font-medium text-[#aeb9d3]">{key.replace("_", " ").toUpperCase()}<select value={filters[key as keyof typeof filters]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#171e35] px-2 text-sm text-white outline-none focus:border-[#9dff73]">{values.map((value) => <option key={value}>{value}</option>)}</select></label>)}</div></form>
    </section>
    <section className="relative mx-auto max-w-7xl px-5 pb-20 sm:px-8">{(hasSearched || error) && <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#9dff73]">Search results</p><h2 className="mt-1 text-2xl font-semibold">{total} compatible games</h2></div><p className="text-sm text-[#9ba8c7]">{mode}. Ordered by reviews, then owners.</p></div>}{error && <p className="rounded-xl border border-red-400/30 bg-red-950/30 p-4 text-red-200">{error}</p>}{!error && hasSearched && results.length === 0 && !loading && <div className="rounded-3xl border border-dashed border-white/15 bg-white/[.025] px-6 py-14 text-center text-[#9ba8c7]">No games match this prompt and specification combination. Try broader filters.</div>}{!hasSearched && <div className="rounded-3xl border border-dashed border-white/15 bg-white/[.025] px-6 py-14 text-center text-[#9ba8c7]">Use the search controls to find games compatible with your PC.</div>}<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{results.map((game, index) => <article key={game.app_id} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#10162a] p-5 transition hover:-translate-y-1 hover:border-[#9dff73]/60"><div className="flex items-start justify-between gap-3"><p className="text-xs font-bold text-[#9dff73]">#{index + 1}</p><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#aeb9d3]">{game.free_to_play ? "Free" : "Paid"}</span></div><h3 className="mt-3 text-2xl font-semibold">{game.title}</h3><p className="mt-2 line-clamp-3 text-sm leading-6 text-[#aeb9d3]">{game.description}</p><div className="mt-4 flex flex-wrap gap-2">{game.genres.slice(0, 3).map((genre) => <span key={genre} className="rounded-md bg-white/7 px-2 py-1 text-xs text-[#d7e0f4]">{genre}</span>)}</div><div className="my-5 grid grid-cols-2 gap-2 border-y border-white/10 py-4"><div><p className="text-lg font-bold">{compact(game.positive_reviews)}</p><p className="text-xs text-[#8390ae]">positive reviews</p></div><div><p className="text-lg font-bold">{compact(game.estimated_owners)}</p><p className="text-xs text-[#8390ae]">estimated owners</p></div></div><p className="text-xs text-[#aeb9d3]">Min: {game.requirements.os} | {game.requirements.ram_gb} GB RAM | {game.requirements.storage_gb} GB storage</p><a href={game.steam_url} target="_blank" rel="noreferrer" className="mt-5 inline-flex text-sm font-bold text-[#9dff73] hover:text-white">View on Steam <span className="ml-1">-&gt;</span></a></article>)}</div></section>
  </main>;
}
