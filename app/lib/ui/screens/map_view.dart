import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app.dart';
import '../../data/tiles.dart';
import '../../model/game.dart';
import '../design/components.dart';
import '../design/pictograms.dart';
import '../design/tokens.dart';
import '../widgets/active_scope.dart';
import '../widgets/direction.dart' show ageText;
import '../widgets/stations.dart';

LatLng _ll(GeoPoint p) => LatLng(p.lat, p.lon);

/// Nachtkarte: Spielfeld als Lichtkegel, außen ein Schleier. Sperrzonen mit Absperrband-Schraffur.
///
/// Kartenkacheln kommen aus dem Spiel (`settings.map.tiles`), sonst von OpenStreetMap. Kacheln des eigenen Servers
/// lädt die App beim Packen vorab und liest sie vom Gerät; andere werden beim Ansehen zwischengespeichert.
/// Ohne Netz und ohne Kacheln sieht die Karte trotzdem gewollt aus: Nachtgrund, Spielfeld, Zonen und Stationen bleiben.
class GameMap extends StatefulWidget {
  const GameMap({super.key, this.focusAssembly = false});
  final bool focusAssembly;

  /// In Widget-Tests aus, weil dort kein Netz für Kartenkacheln da ist.
  static bool showTiles = true;

  /// Zwischenspeicher der Karte für Kacheln, die nicht vorab geladen wurden; null heißt der eingebaute.
  /// Tests setzen einen ohne Plugin für den App-Ordner.
  @visibleForTesting
  static MapCachingProvider? cachingProvider;

  @override
  State<GameMap> createState() => _GameMapState();
}

class _GameMapState extends State<GameMap> {
  final _map = MapController();
  bool _follow = true;
  bool _ready = false;
  double _minZoom = _defaultMinZoom;

  List<LatLng> _areaPoints(Area a) {
    if (!a.isCircle) return a.polygon.map(_ll).toList();
    // Kreis als Vieleck, damit Polygon-Layer und Schleier einheitlich bleiben.
    return circlePoints(a.center, a.radius);
  }

  void _move(LatLng p, [double? zoom]) {
    if (!_ready) return;
    try {
      _map.move(p, zoom ?? _map.camera.zoom);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return QuietListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final t = context.tok;
        final p = t.p;
        final game = c.game!;
        final field = game.field;
        final pos = c.position;
        // Eine alte Position bleibt als blasse Spur sichtbar, gilt aber nicht als aktuell.
        final stale = c.positionStale;
        if (_follow && pos != null && !widget.focusAssembly) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _move(_ll(pos)));
        }
        final assembly = field.assemblyPoint.location;
        final center = widget.focusAssembly
            ? assembly
            : (pos ?? field.start ?? (field.boundary.isCircle ? field.boundary.center : field.boundary.polygon.first));
        final source = c.tileSource;
        // Ein Kartenpaket hat eine kleinste Stufe; darunter wäre die Karte leer.
        _minZoom = math.max(_defaultMinZoom, c.tileMinZoom?.toDouble() ?? 0);
        final boundary = _areaPoints(field.boundary);
        final showTiles = GameMap.showTiles && t.mode != LightMode.red;
        final next = c.nextTarget;
        final number = {for (final (i, s) in game.stations.indexed) s.id: '${i + 1}'};

        return Stack(
          children: [
            FlutterMap(
              mapController: _map,
              options: MapOptions(
                initialCenter: _ll(center),
                initialZoom: 16.5,
                maxZoom: 19,
                minZoom: _minZoom,
                backgroundColor: p.ground,
                interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
                onMapReady: () => _ready = true,
                onPositionChanged: (_, hasGesture) {
                  if (hasGesture && _follow) setState(() => _follow = false);
                },
              ),
              children: [
                if (!showTiles) const Positioned.fill(child: NightGround()),
                if (showTiles)
                  _tinted(
                    t.mode,
                    source.own
                        ? OwnTileLayers(key: ValueKey(source.url), source: source, store: c.tileStore)
                        : TileLayer(
                            urlTemplate: source.url,
                            userAgentPackageName: userAgent,
                            maxNativeZoom: 19,
                            tileProvider: GameMap.cachingProvider == null ? null : NetworkTileProvider(cachingProvider: GameMap.cachingProvider),
                          ),
                    nightTiles: source.night,
                  ),
                PolygonLayer(
                  polygons: [
                    // Schleier außerhalb des Spielfelds
                    Polygon(
                      points: _world(boundary),
                      holePointsList: [boundary],
                      color: Colors.black.withValues(alpha: t.mode == LightMode.day ? 0.35 : 0.55),
                      borderStrokeWidth: 0,
                      disableHolesBorder: true,
                    ),
                    Polygon(
                      points: boundary,
                      color: Colors.transparent,
                      borderColor: p.accent,
                      borderStrokeWidth: 3,
                      pattern: StrokePattern.dashed(segments: const [14, 9]),
                    ),
                    for (final z in field.restrictedZones)
                      Polygon(
                        points: _areaPoints(z.area),
                        color: p.tapeB.withValues(alpha: 0.12),
                        borderColor: p.tapeB,
                        borderStrokeWidth: 2,
                        pattern: StrokePattern.dashed(segments: const [8, 6]),
                      ),
                    for (final s in c.visibleStations)
                      if (markState(c, s) == MarkState.rumor && s.location != null)
                        Polygon(
                          points: circlePoints(rumorCenter(s), 60),
                          color: p.accent.withValues(alpha: 0.08),
                          borderColor: p.accent,
                          borderStrokeWidth: 2,
                          pattern: StrokePattern.dashed(segments: const [6, 8]),
                        ),
                  ],
                ),
                PolylineLayer(
                  polylines: [
                    for (final z in field.restrictedZones)
                      for (final seg in hatchLines(_areaPoints(z.area), 7)) Polyline(points: seg, color: p.tapeA.withValues(alpha: 0.75), strokeWidth: 3),
                    if (c.trail.length > 1)
                      Polyline(
                        points: [for (final (g, _) in c.trail) _ll(g)],
                        color: p.text.withValues(alpha: 0.45),
                        strokeWidth: 3,
                        pattern: const StrokePattern.dotted(spacingFactor: 2.5),
                      ),
                    if ((c.recalled || widget.focusAssembly) && pos != null)
                      Polyline(
                        points: [_ll(pos), _ll(assembly)],
                        color: p.tapeB,
                        strokeWidth: 4,
                        pattern: StrokePattern.dashed(segments: const [12, 8]),
                      ),
                  ],
                ),
                if (pos != null && c.accuracy != null && !stale)
                  CircleLayer(
                    circles: [
                      CircleMarker(
                        point: _ll(pos),
                        radius: c.accuracy!,
                        useRadiusInMeter: true,
                        color: p.accentBright.withValues(alpha: 0.10),
                        borderColor: p.accentBright.withValues(alpha: 0.5),
                        borderStrokeWidth: 1,
                      ),
                    ],
                  ),
                MarkerLayer(
                  markers: [
                    for (final z in field.restrictedZones)
                      Marker(
                        point: _centroid(_areaPoints(z.area)),
                        width: 150,
                        height: 76,
                        child: _ZoneLabel(name: z.name.of(context)),
                      ),
                    for (final s in c.visibleStations)
                      if (s.location != null && markState(c, s) != MarkState.rumor)
                        Marker(
                          point: _ll(s.location!),
                          width: 64,
                          height: 64,
                          child: GestureDetector(
                            onTap: () => openStation(context, s.id),
                            child: Center(
                              child: StationMark(
                                state: markState(c, s),
                                label: number[s.id]!,
                                highlight: s == next,
                                pulse: s == next || markState(c, s) == MarkState.awake,
                              ),
                            ),
                          ),
                        ),
                    for (final s in c.visibleStations)
                      if (s.location != null && markState(c, s) == MarkState.rumor)
                        Marker(
                          point: _ll(rumorCenter(s)),
                          width: 120,
                          height: 40,
                          child: Center(child: Caps('irgendwo hier', color: p.accent)),
                        ),
                    // Sicherheitspunkte liegen über den Stationen.
                    for (final r in field.rescuePoints) Marker(point: _ll(r.location), width: 34, height: 34, child: const Pictogram(Picto.firstAid, size: 30)),
                    Marker(
                      point: _ll(assembly),
                      width: c.recalled ? 56 : 40,
                      height: c.recalled ? 56 : 40,
                      child: Pictogram(Picto.assembly, size: c.recalled ? 52 : 36),
                    ),
                    if (pos != null && game.settings.showOwnPosition)
                      Marker(
                        point: _ll(pos),
                        width: 44,
                        height: 44,
                        child: Opacity(opacity: stale ? 0.4 : 1, child: const _Me()),
                      ),
                  ],
                ),
              ],
            ),
            if (showTiles) const Positioned(left: 8, bottom: 6, child: MapAttribution()),
            if (stale)
              Positioned(
                top: 12,
                left: 12,
                right: 80,
                child: ValueListenableBuilder<int>(
                  valueListenable: c.clock,
                  builder: (context, _, _) => Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: p.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: p.accent, width: 2),
                    ),
                    child: Text(
                      'Ortung veraltet${c.positionAge == null ? '' : ' · Position ${ageText(c.positionAge!)}'}',
                      style: t.small.copyWith(color: p.text),
                    ),
                  ),
                ),
              )
            else if (c.accuracy != null && c.accuracy! > 25)
              Positioned(
                top: 12,
                left: 12,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: p.surface,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: p.line),
                  ),
                  child: Text('Signal schwankt (±${c.accuracy!.round()} m)', style: t.small.copyWith(color: p.text)),
                ),
              ),
            Positioned(
              right: 12,
              bottom: 24,
              child: Column(
                children: [
                  _MapKey(icon: Icons.add_rounded, label: 'Näher', onTap: () => _move(_map.camera.center, math.min(19, _map.camera.zoom + 1))),
                  const SizedBox(height: 8),
                  _MapKey(icon: Icons.remove_rounded, label: 'Weiter weg', onTap: () => _move(_map.camera.center, math.max(_minZoom, _map.camera.zoom - 1))),
                  const SizedBox(height: 16),
                  _MapKey(
                    icon: _follow ? Icons.my_location_rounded : Icons.location_searching_rounded,
                    label: 'Auf mich',
                    size: 64,
                    lit: _follow,
                    onTap: pos == null
                        ? null
                        : () {
                            setState(() => _follow = true);
                            _move(_ll(pos), 17);
                          },
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _tinted(LightMode m, Widget tiles, {bool nightTiles = false}) {
    final filter = tileFilterFor(m, nightTiles: nightTiles);
    return filter == null ? tiles : ColorFiltered(colorFilter: filter, child: tiles);
  }

  List<LatLng> _world(List<LatLng> hole) {
    final lats = hole.map((p) => p.latitude), lons = hole.map((p) => p.longitude);
    final a = lats.reduce(math.min) - 1, b = lats.reduce(math.max) + 1;
    final cc = lons.reduce(math.min) - 1.5, d = lons.reduce(math.max) + 1.5;
    return [LatLng(a, cc), LatLng(a, d), LatLng(b, d), LatLng(b, cc)];
  }

  LatLng _centroid(List<LatLng> pts) {
    final lat = pts.map((p) => p.latitude).reduce((a, b) => a + b) / pts.length;
    final lon = pts.map((p) => p.longitude).reduce((a, b) => a + b) / pts.length;
    return LatLng(lat, lon);
  }
}

const _defaultMinZoom = 13.0;

/// Kennung der App gegenüber Kartenservern (User-Agent)
const userAgent = 'io.github.wolfsrudelgaming.lykora';

/// Filter für die Kacheln im Lichtmodus [m]; null heißt: Kacheln unverändert.
///
/// Tageskacheln werden nachts invertiert und stark gedimmt, damit die Karte nicht blendet. Ein Nachtpaket
/// ([nightTiles], Adresse mit `-nacht`) ist schon dunkel: Es wird nicht invertiert, nur in Bernstein getönt.
ColorFilter? tileFilterFor(LightMode m, {bool nightTiles = false}) {
  if (m == LightMode.day) return null;
  const l = [0.3, 0.59, 0.11];
  if (nightTiles) {
    if (m != LightMode.amber) return null;
    return ColorFilter.matrix([
      for (final k in [0.6, 0.4, 0.0]) ...[l[0] * k, l[1] * k, l[2] * k, 0, 0],
      0, 0, 0, 1, 0, //
    ]);
  }
  if (m == LightMode.amber) {
    return ColorFilter.matrix([
      for (final k in [0.5, 0.33, 0.0]) ...[-l[0] * k, -l[1] * k, -l[2] * k, 0, 255 * k],
      0, 0, 0, 1, 0, //
    ]);
  }
  return ColorFilter.matrix([
    for (final (k, add) in [(0.3, 8.0), (0.29, 6.0), (0.27, 4.0)]) ...[-l[0] * k, -l[1] * k, -l[2] * k, 0, 255 * k + add],
    0, 0, 0, 1, 0, //
  ]);
}

/// Karte des eigenen Servers: unten Stufe 17 für den Rand, darüber die feinste Stufe 18, wo das Paket sie hat.
///
/// Fehlt eine Kachel (404) oder fehlt das Netz, bleibt die obere Kachel durchsichtig und die Stufe 17 darunter
/// zeigt sich hochgezogen. Geladene Kacheln liegen im Ordner auf dem Gerät und gehen ohne Netz.
class OwnTileLayers extends StatefulWidget {
  const OwnTileLayers({super.key, required this.source, required this.store});
  final TileSource source;
  final TileStore store;

  @override
  State<OwnTileLayers> createState() => _OwnTileLayersState();
}

class _OwnTileLayersState extends State<OwnTileLayers> {
  // Jede Ebene gibt ihren Anbieter beim Abbau selbst frei; deshalb zwei eigene und neue bei jedem Aufbau.
  late final _under = OwnTileProvider(store: widget.store, pack: widget.source.pack!, cachingProvider: GameMap.cachingProvider);
  late final _over = OwnTileProvider(store: widget.store, pack: widget.source.pack!, cachingProvider: GameMap.cachingProvider);

  @override
  Widget build(BuildContext context) {
    final url = widget.source.url;
    return Stack(
      fit: StackFit.expand,
      children: [
        TileLayer(urlTemplate: url, userAgentPackageName: userAgent, maxNativeZoom: 17, tileProvider: _under, errorTileCallback: _silent),
        TileLayer(urlTemplate: url, userAgentPackageName: userAgent, maxNativeZoom: 18, tileProvider: _over, errorTileCallback: _silent),
      ],
    );
  }

  static void _silent(TileImage tile, Object error, StackTrace? stackTrace) {}
}

/// Zuschreibung der Kartendaten (ODbL): bleibt sichtbar, solange Kacheln da sind; Tippen öffnet die Lizenzseite.
class MapAttribution extends StatelessWidget {
  const MapAttribution({super.key});

  static const text = '© OpenStreetMap-Mitwirkende';

  /// Öffnet die Lizenzseite im Browser; Tests setzen eine eigene Funktion ein.
  static Future<void> Function(Uri uri) open = (uri) async {
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
  };

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final p = t.p;
    return Semantics(
      link: true,
      label: 'Kartendaten OpenStreetMap-Mitwirkende, Lizenz öffnen',
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => open(Uri.parse(osmCopyrightUrl)),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(color: p.ground.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(4)),
          child: Text(text, style: t.small.copyWith(fontSize: 12, color: p.text, decoration: TextDecoration.underline, decorationColor: p.text)),
        ),
      ),
    );
  }
}

/// Kreis als Vieleck um [c] mit [radius] Metern.
List<LatLng> circlePoints(GeoPoint c, double radius, {int steps = 48}) {
  final dLat = radius / 111320;
  final dLon = radius / (111320 * math.cos(c.lat * math.pi / 180));
  return [for (var i = 0; i < steps; i++) LatLng(c.lat + dLat * math.sin(i * 2 * math.pi / steps), c.lon + dLon * math.cos(i * 2 * math.pi / steps))];
}

/// Mittelpunkt des Gerüchte-Kreises: fest, aber bis zu 25 m neben der Station, damit er sie nicht verrät.
GeoPoint rumorCenter(Station s) {
  final rnd = math.Random(s.id.hashCode);
  final a = rnd.nextDouble() * 2 * math.pi, d = 10 + rnd.nextDouble() * 15;
  final l = s.location!;
  return GeoPoint(l.lat + d * math.sin(a) / 111320, l.lon + d * math.cos(a) / (111320 * math.cos(l.lat * math.pi / 180)));
}

/// Diagonale Schraffur einer Fläche als Liniensegmente im Abstand [spacing] Meter.
List<List<LatLng>> hatchLines(List<LatLng> poly, double spacing) {
  if (poly.length < 3) return const [];
  final lat0 = poly.first.latitude, lon0 = poly.first.longitude;
  final kx = 111320 * math.cos(lat0 * math.pi / 180), ky = 111320.0;
  // In ein um 45° gedrehtes Meter-Koordinatensystem (u entlang der Linien, v quer dazu)
  final pts = [for (final p in poly) _rot((p.longitude - lon0) * kx, (p.latitude - lat0) * ky)];
  final vs = pts.map((p) => p.$2);
  final vMin = vs.reduce(math.min), vMax = vs.reduce(math.max);
  final out = <List<LatLng>>[];
  for (var v = vMin + spacing / 2; v < vMax; v += spacing) {
    final us = <double>[];
    for (var i = 0; i < pts.length; i++) {
      final a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a.$2 <= v && b.$2 > v) || (b.$2 <= v && a.$2 > v)) {
        us.add(a.$1 + (v - a.$2) / (b.$2 - a.$2) * (b.$1 - a.$1));
      }
    }
    us.sort();
    for (var i = 0; i + 1 < us.length; i += 2) {
      LatLng back(double u) {
        final (x, y) = _unrot(u, v);
        return LatLng(lat0 + y / ky, lon0 + x / kx);
      }

      out.add([back(us[i]), back(us[i + 1])]);
    }
  }
  return out;
}

const _c45 = 0.7071067811865476;
(double, double) _rot(double x, double y) => (x * _c45 + y * _c45, -x * _c45 + y * _c45);
(double, double) _unrot(double u, double v) => (u * _c45 - v * _c45, u * _c45 + v * _c45);

class _Me extends StatelessWidget {
  const _Me();

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    return Stack(
      alignment: Alignment.center,
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(colors: [p.accent.withValues(alpha: 0.45), p.accent.withValues(alpha: 0)]),
          ),
        ),
        Container(
          width: 18,
          height: 18,
          decoration: BoxDecoration(
            color: p.text,
            shape: BoxShape.circle,
            border: Border.all(color: p.ground, width: 3),
          ),
        ),
      ],
    );
  }
}

class _ZoneLabel extends StatelessWidget {
  const _ZoneLabel({required this.name});
  final String name;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Pictogram(Picto.prohibited, size: 34),
        const SizedBox(height: 4),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          color: Colors.black.withValues(alpha: 0.75),
          child: Text(
            '$name – nicht betreten',
            style: t.small.copyWith(fontSize: 12, color: t.monochrome ? t.p.text : Colors.white),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _MapKey extends StatelessWidget {
  const _MapKey({required this.icon, required this.label, required this.onTap, this.size = 56, this.lit = false});
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final double size;
  final bool lit;

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: p.surface,
            borderRadius: BorderRadius.circular(Space.radius),
            border: Border.all(color: lit ? p.accent : p.edge, width: 2),
          ),
          child: Icon(icon, color: onTap == null ? p.textMuted : p.text, size: 28),
        ),
      ),
    );
  }
}

/// Karte als eigene Seite, z. B. aus dem Rückruf: zeigt den Weg zum Sammelpunkt.
class MapPage extends StatelessWidget {
  const MapPage({super.key, this.focusAssembly = false});
  final bool focusAssembly;

  @override
  Widget build(BuildContext context) {
    return StageScaffold(
      title: focusAssembly ? 'Weg zum Sammelpunkt' : 'Karte',
      ground: false,
      body: GameMap(focusAssembly: focusAssembly),
    );
  }
}
