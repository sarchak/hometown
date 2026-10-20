// Candidate markets the agent can rank. Coordinates are only used to seed the mock
// layer and to centre the map before Qloo heatmap cells arrive.
export interface City { name: string; q: string; lat: number; lon: number; regions: string[] }

const c = (name: string, q: string, lat: number, lon: number, ...regions: string[]): City => ({ name, q, lat, lon, regions });

export const CITIES: City[] = [
  c("New York", "New York City", 40.7128, -74.006, "us", "us-east"),
  c("Los Angeles", "Los Angeles", 34.0522, -118.2437, "us", "us-west"),
  c("Chicago", "Chicago", 41.8781, -87.6298, "us", "us-midwest"),
  c("Houston", "Houston", 29.7604, -95.3698, "us", "us-south"),
  c("Phoenix", "Phoenix", 33.4484, -112.074, "us", "us-west"),
  c("Philadelphia", "Philadelphia", 39.9526, -75.1652, "us", "us-east"),
  c("San Antonio", "San Antonio", 29.4241, -98.4936, "us", "us-south"),
  c("San Diego", "San Diego", 32.7157, -117.1611, "us", "us-west"),
  c("Dallas", "Dallas", 32.7767, -96.797, "us", "us-south"),
  c("Austin", "Austin", 30.2672, -97.7431, "us", "us-south"),
  c("San Francisco", "San Francisco", 37.7749, -122.4194, "us", "us-west"),
  c("Seattle", "Seattle", 47.6062, -122.3321, "us", "us-west"),
  c("Denver", "Denver", 39.7392, -104.9903, "us", "us-west"),
  c("Nashville", "Nashville", 36.1627, -86.7816, "us", "us-south"),
  c("Washington DC", "Washington, D.C.", 38.9072, -77.0369, "us", "us-east"),
  c("Boston", "Boston", 42.3601, -71.0589, "us", "us-east"),
  c("Atlanta", "Atlanta", 33.749, -84.388, "us", "us-south"),
  c("Miami", "Miami", 25.7617, -80.1918, "us", "us-south"),
  c("Detroit", "Detroit", 42.3314, -83.0458, "us", "us-midwest"),
  c("Minneapolis", "Minneapolis", 44.9778, -93.265, "us", "us-midwest"),
  c("Portland", "Portland, Oregon", 45.5152, -122.6784, "us", "us-west"),
  c("Las Vegas", "Las Vegas", 36.1699, -115.1398, "us", "us-west"),
  c("New Orleans", "New Orleans", 29.9511, -90.0715, "us", "us-south"),
  c("Charlotte", "Charlotte", 35.2271, -80.8431, "us", "us-south"),
  c("Pittsburgh", "Pittsburgh", 40.4406, -79.9959, "us", "us-east"),
  c("St. Louis", "St. Louis", 38.627, -90.1994, "us", "us-midwest"),
  c("Kansas City", "Kansas City", 39.0997, -94.5786, "us", "us-midwest"),
  c("Salt Lake City", "Salt Lake City", 40.7608, -111.891, "us", "us-west"),
  c("Columbus", "Columbus, Ohio", 39.9612, -82.9988, "us", "us-midwest"),
  c("Milwaukee", "Milwaukee", 43.0389, -87.9065, "us", "us-midwest"),
  c("Indianapolis", "Indianapolis", 39.7684, -86.1581, "us", "us-midwest"),
  c("Cleveland", "Cleveland", 41.4993, -81.6944, "us", "us-midwest"),
  c("Raleigh", "Raleigh", 35.7796, -78.6382, "us", "us-south"),
  c("Tampa", "Tampa", 27.9506, -82.4572, "us", "us-south"),
  c("Orlando", "Orlando", 28.5383, -81.3792, "us", "us-south"),
  c("Sacramento", "Sacramento", 38.5816, -121.4944, "us", "us-west"),
  c("Baltimore", "Baltimore", 39.2904, -76.6122, "us", "us-east"),
  c("Toronto", "Toronto", 43.6532, -79.3832, "canada"),
  c("Montreal", "Montreal", 45.5017, -73.5673, "canada"),
  c("Vancouver", "Vancouver", 49.2827, -123.1207, "canada"),
  c("Calgary", "Calgary", 51.0447, -114.0719, "canada"),
  c("London", "London", 51.5074, -0.1278, "uk", "europe"),
  c("Manchester", "Manchester", 53.4808, -2.2426, "uk", "europe"),
  c("Glasgow", "Glasgow", 55.8642, -4.2518, "uk", "europe"),
  c("Dublin", "Dublin", 53.3498, -6.2603, "uk", "europe"),
  c("Birmingham", "Birmingham, England", 52.4862, -1.8904, "uk", "europe"),
  c("Paris", "Paris", 48.8566, 2.3522, "europe"),
  c("Berlin", "Berlin", 52.52, 13.405, "europe"),
  c("Amsterdam", "Amsterdam", 52.3676, 4.9041, "europe"),
  c("Madrid", "Madrid", 40.4168, -3.7038, "europe"),
  c("Barcelona", "Barcelona", 41.3851, 2.1734, "europe"),
  c("Lisbon", "Lisbon", 38.7223, -9.1393, "europe"),
  c("Copenhagen", "Copenhagen", 55.6761, 12.5683, "europe"),
  c("Stockholm", "Stockholm", 59.3293, 18.0686, "europe"),
  c("Milan", "Milan", 45.4642, 9.19, "europe"),
  c("Sydney", "Sydney", -33.8688, 151.2093, "australia"),
  c("Melbourne", "Melbourne", -37.8136, 144.9631, "australia"),
  c("Brisbane", "Brisbane", -27.4698, 153.0251, "australia"),
  c("Mexico City", "Mexico City", 19.4326, -99.1332, "latam"),
  c("São Paulo", "São Paulo", -23.5505, -46.6333, "latam"),
  c("Tokyo", "Tokyo", 35.6762, 139.6503, "asia"),
  c("Seoul", "Seoul", 37.5665, 126.978, "asia"),
];

export const REGIONS = ["us", "us-east", "us-west", "us-south", "us-midwest", "canada", "uk", "europe", "australia", "latam", "asia"];

export function citiesFor(region?: string, custom?: string[]): City[] {
  if (custom?.length) {
    return custom.map((name) => {
      const hit = CITIES.find((x) => x.name.toLowerCase() === name.toLowerCase() || x.q.toLowerCase() === name.toLowerCase());
      return hit ?? { name, q: name, lat: 0, lon: 0, regions: [] };
    });
  }
  const r = (region ?? "us").toLowerCase();
  const hits = CITIES.filter((x) => x.regions.includes(r));
  return hits.length ? hits : CITIES.filter((x) => x.regions.includes("us"));
}
