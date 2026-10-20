import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../app.dart';
import '../../model/game.dart';
import '../theme.dart';
import 'station_screen.dart';

LatLng _ll(GeoPoint p) => LatLng(p.lat, p.lon);

/// Karte mit Spielfeld, Sperrzonen, Stationen und eigener Position.
///
/// Kartenkacheln werden beim Ansehen zwischengespeichert. Ohne Netz und ohne Kacheln
/// bleiben Spielfeld, Zonen und Stationen trotzdem sichtbar.
class MapTab extends StatefulWidget {
  const MapTab({super.key});

  /// In Widget-Tests aus, weil dort kein Netz für Kartenkacheln da ist.
  static bool showTiles = true;

  @override
  State<MapTab> createState() => _MapTabState();
}

class _MapTabState extends State<MapTab> {
  final _map = MapController();
  bool _follow = true;

  List<LatLng> _areaPoints(Area a) {
    if (!a.isCircle) return a.polygon.map(_ll).toList();
    // Kreis als Vieleck, damit Polygon-Layer und Hit-Test einheitlich bleiben.
    const steps = 48;
    final c = a.center;
    final dLat = a.radius / 111320;
    final dLon = a.radius / (111320 * cosDeg(c.lat));
    return [for (var i = 0; i < steps; i++) LatLng(c.lat + dLat * sinDeg(i * 360 / steps), c.lon + dLon * cosDeg(i * 360 / steps))];
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final game = c.game!;
        final field = game.field;
        final pos = c.position;
        if (_follow && pos != null) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            try {
              _map.move(_ll(pos), _map.camera.zoom);
            } catch (_) {}
          });
        }
        final center = pos ?? field.start ?? (field.boundary.isCircle ? field.boundary.center : field.boundary.polygon.first);
        final tiles = game.settings.tiles ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
        final assembly = field.assemblyPoint.location;

        return Stack(children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: _ll(center),
              initialZoom: 16,
              maxZoom: 19,
              backgroundColor: const Color(0xFF1B1D22),
              onPositionChanged: (_, hasGesture) {
                if (hasGesture && _follow) setState(() => _follow = false);
              },
            ),
            children: [
              if (MapTab.showTiles) TileLayer(urlTemplate: tiles, userAgentPackageName: 'io.github.wolfsrudelgaming.lykora', maxNativeZoom: 19),
              PolygonLayer(polygons: [
                Polygon(points: _areaPoints(field.boundary), color: Colors.transparent, borderColor: lantern, borderStrokeWidth: 3),
                for (final z in field.restrictedZones)
                  Polygon(points: _areaPoints(z.area), color: sosRed.withValues(alpha: 0.35), borderColor: sosRed, borderStrokeWidth: 2),
              ]),
              if (pos != null && c.accuracy != null)
                CircleLayer(circles: [
                  CircleMarker(point: _ll(pos), radius: c.accuracy!, useRadiusInMeter: true, color: Colors.lightBlueAccent.withValues(alpha: 0.18), borderColor: Colors.lightBlueAccent, borderStrokeWidth: 1),
                ]),
              MarkerLayer(markers: [
                Marker(point: _ll(assembly), width: 44, height: 44, child: const _Pin(icon: Icons.flag, color: Colors.white, background: Colors.indigo)),
                for (final r in field.rescuePoints)
                  Marker(point: _ll(r.location), width: 36, height: 36, child: const _Pin(icon: Icons.local_hospital, color: Colors.white, background: sosRed)),
                for (final s in c.visibleStations)
                  if (s.location != null)
                    Marker(
                      point: _ll(s.location!),
                      width: 48,
                      height: 48,
                      child: GestureDetector(
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => StationScreen(stationId: s.id))),
                        child: _Pin(
                          icon: s.isFinal ? Icons.lock_open : (c.state.solved.containsKey(s.id) ? Icons.check : Icons.question_mark),
                          color: Colors.black,
                          background: c.state.solved.containsKey(s.id) ? okGreen : lantern,
                        ),
                      ),
                    ),
                if (pos != null && game.settings.showOwnPosition)
                  Marker(
                    point: _ll(pos),
                    width: 22,
                    height: 22,
                    child: Container(
                      decoration: BoxDecoration(color: Colors.lightBlueAccent, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3)),
                    ),
                  ),
              ]),
              const RichAttributionWidget(attributions: [TextSourceAttribution('OpenStreetMap-Mitwirkende')]),
            ],
          ),
          Positioned(
            right: 12,
            bottom: 24,
            child: Column(children: [
              FloatingActionButton.small(
                heroTag: 'assembly',
                tooltip: 'Sammelpunkt',
                onPressed: () {
                  setState(() => _follow = false);
                  _map.move(_ll(assembly), 17);
                },
                child: const Icon(Icons.flag),
              ),
              const SizedBox(height: 8),
              FloatingActionButton(
                heroTag: 'me',
                tooltip: 'Mein Standort',
                onPressed: pos == null
                    ? null
                    : () {
                        setState(() => _follow = true);
                        _map.move(_ll(pos), 17);
                      },
                child: Icon(_follow ? Icons.my_location : Icons.location_searching),
              ),
            ]),
          ),
          if (c.recalled)
            Positioned(
              left: 12,
              right: 80,
              bottom: 24,
              child: Card(
                color: sosRed,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    pos == null
                        ? 'Zum Sammelpunkt (Fahne) gehen.'
                        : 'Sammelpunkt: ${distanceText(pos, assembly)} – Fahne auf der Karte.',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
            ),
        ]);
      },
    );
  }
}

String distanceText(GeoPoint from, GeoPoint to) {
  final d = const Distance().as(LengthUnit.Meter, _ll(from), _ll(to));
  return d >= 1000 ? '${(d / 1000).toStringAsFixed(1)} km' : '${d.round()} m';
}

double cosDeg(double deg) => math.cos(deg * math.pi / 180);
double sinDeg(double deg) => math.sin(deg * math.pi / 180);

class _Pin extends StatelessWidget {
  const _Pin({required this.icon, required this.color, required this.background});
  final IconData icon;
  final Color color;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(color: background, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2), boxShadow: const [BoxShadow(blurRadius: 4)]),
      child: Icon(icon, color: color, size: 22),
    );
  }
}
