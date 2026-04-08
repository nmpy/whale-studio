// src/lib/geo.ts
// 球面距離計算（Haversine 公式）

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * 2点間の球面距離をメートルで返す（Haversine）。
 */
export function getDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 指定座標が location の許容範囲内かを判定する。
 */
export function isWithinRadius(
  userLat: number,
  userLng: number,
  locationLat: number,
  locationLng: number,
  radiusMeters: number,
): { within: boolean; distanceMeters: number } {
  const distanceMeters = Math.round(getDistanceMeters(userLat, userLng, locationLat, locationLng));
  return { within: distanceMeters <= radiusMeters, distanceMeters };
}
