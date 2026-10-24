import 'dart:math' as math;

import '../model/game.dart';

const _earthRadius = 6371008.8;
double _rad(double deg) => deg * math.pi / 180;

/// Abstand zweier Punkte in Metern (Haversine).
double distance(GeoPoint a, GeoPoint b) {
  final dLat = _rad(b.lat - a.lat);
  final dLon = _rad(b.lon - a.lon);
  final h = math.pow(math.sin(dLat / 2), 2) + math.cos(_rad(a.lat)) * math.cos(_rad(b.lat)) * math.pow(math.sin(dLon / 2), 2);
  return 2 * _earthRadius * math.asin(math.min(1, math.sqrt(h)));
}

// Lokale ebene Projektion in Metern; reicht für Spielfelder von wenigen Kilometern.
(double, double) _project(GeoPoint origin, GeoPoint p) =>
    (_rad(p.lon - origin.lon) * _earthRadius * math.cos(_rad(origin.lat)), _rad(p.lat - origin.lat) * _earthRadius);

bool _insidePolygon(GeoPoint p, List<GeoPoint> polygon) {
  var inside = false;
  for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    final a = polygon[i];
    final b = polygon[j];
    if ((a.lat > p.lat) != (b.lat > p.lat) && p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon) {
      inside = !inside;
    }
  }
  return inside;
}

double _segmentDistance((double, double) p, (double, double) a, (double, double) b) {
  final dx = b.$1 - a.$1;
  final dy = b.$2 - a.$2;
  final len = dx * dx + dy * dy;
  final t = len == 0 ? 0.0 : (((p.$1 - a.$1) * dx + (p.$2 - a.$2) * dy) / len).clamp(0.0, 1.0);
  final x = p.$1 - (a.$1 + t * dx);
  final y = p.$2 - (a.$2 + t * dy);
  return math.sqrt(x * x + y * y);
}

/// Abstand eines Punkts zu einer Fläche in Metern; 0, wenn er darin liegt.
double distanceToArea(GeoPoint p, Area area) {
  if (area.isCircle) return math.max(0, distance(p, area.center) - area.radius);
  final polygon = area.polygon;
  if (_insidePolygon(p, polygon)) return 0;
  final pts = polygon.map((q) => _project(p, q)).toList();
  var best = double.infinity;
  for (var i = 0; i < pts.length; i++) {
    best = math.min(best, _segmentDistance((0, 0), pts[i], pts[(i + 1) % pts.length]));
  }
  return best;
}
