import { listTeams } from "../fathom/api";
import type { Team } from "../types/Types";

/**
 * Predefined color palette for team tags
 * Using Raycast's color palette for consistency
 */
const TEAM_COLORS = [
  "#FF6B6B", // Red
  "#4ECDC4", // Teal
  "#45B7D1", // Blue
  "#FFA07A", // Light Salmon
  "#98D8C8", // Mint
  "#F7DC6F", // Yellow
  "#BB8FCE", // Purple
  "#85C1E2", // Sky Blue
  "#F8B739", // Orange
  "#52C41A", // Green
  "#EB5757", // Crimson
  "#2F80ED", // Ocean Blue
  "#9B59B6", // Violet
  "#E67E22", // Carrot
  "#1ABC9C", // Turquoise
  "#E91E63", // Pink
  "#00BCD4", // Cyan
  "#FF9800", // Amber
  "#795548", // Brown
  "#607D8B", // Blue Grey
];

interface TeamColorCache {
  teams: Team[];
  colorMap: Map<string, string>;
  lastFetched: number;
}

let cache: TeamColorCache | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches all teams and builds a color map
 * Results are cached for 5 minutes to avoid excessive API calls
 */
async function fetchAndCacheTeams(): Promise<TeamColorCache> {
  const now = Date.now();

  // Return cached data if still valid
  if (cache && now - cache.lastFetched < CACHE_DURATION) {
    return cache;
  }

  // Fetch all teams (paginate if needed)
  const teams: Team[] = [];
  let cursor: string | undefined = undefined;

  try {
    do {
      const result = await listTeams({ cursor });
      teams.push(...result.items);
      cursor = result.nextCursor;
    } while (cursor);
  } catch (error) {
    console.error("Failed to fetch teams for color mapping:", error);
    // If fetch fails but we have cached data, return it even if stale
    if (cache) {
      return cache;
    }
    // Otherwise return empty cache
    return {
      teams: [],
      colorMap: new Map(),
      lastFetched: now,
    };
  }

  // Build color map - assign colors deterministically based on team order
  const colorMap = new Map<string, string>();
  teams.forEach((team, index) => {
    const color = TEAM_COLORS[index % TEAM_COLORS.length];
    colorMap.set(team.name, color);
  });

  cache = {
    teams,
    colorMap,
    lastFetched: now,
  };

  return cache;
}

/**
 * Gets the color for a specific team name
 * Returns a consistent color for each team, fetching team list if needed
 *
 * @param teamName - The name of the team
 * @returns Hex color string (e.g., "#FF6B6B") or undefined if team not found
 */
export async function getTeamColor(teamName: string | null | undefined): Promise<string | undefined> {
  if (!teamName) return undefined;

  const teamCache = await fetchAndCacheTeams();
  return teamCache.colorMap.get(teamName);
}

/**
 * Gets the color for a team synchronously from cache
 * Use this when you need immediate access and can tolerate missing colors for uncached teams
 *
 * @param teamName - The name of the team
 * @returns Hex color string or undefined if not in cache
 */
export function getTeamColorSync(teamName: string | null | undefined): string | undefined {
  if (!teamName || !cache) return undefined;
  return cache.colorMap.get(teamName);
}

/**
 * Pre-fetches and caches team colors
 * Call this early in your component lifecycle to ensure colors are available
 */
export async function prefetchTeamColors(): Promise<void> {
  await fetchAndCacheTeams();
}

/**
 * Clears the team color cache
 * Useful for testing or forcing a refresh
 */
export function clearTeamColorCache(): void {
  cache = null;
}
