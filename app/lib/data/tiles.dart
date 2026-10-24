import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/painting.dart';
import 'package:flutter_map/flutter_map.dart';

import '../model/game.dart';
import 'api.dart';

/// Kacheln von OpenStreetMap: gilt, wenn das Spiel keine (brauchbare) Adresse einträgt. Dafür wird nie vorab geladen.
const osmTileTemplate = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const osmCopyrightUrl = 'https://www.openstreetmap.org/copyright';

/// Höchstens so viele Kacheln lädt die App vorab; darüber fallen die feinsten Stufen weg.
const maxPrefetchTiles = 400;

/// Rand um das Spielfeld in Metern, damit der Rand der Karte nicht leer ist.
const prefetchMarginM = 100.0;

/// Die feinste Stufe liegt im Kartenpaket nur nahe der Mitte (siehe server/tool/map_pack.py, Standard 18=450).
const defaultZoomRadiusM = {18: 450.0};

/// Woher die Kacheln eines Spiels kommen.
class TileSource {
  const TileSource({required this.url, this.own = false, this.pack});

  /// Vorlage mit {z}, {x}, {y}, vollständig
  final String url;

  /// Kacheln des eigenen Servers (Kartenpaket): nur dann lädt die App sie vorab und liest sie vom Gerät
  final bool own;

  /// Ordnername auf dem Gerät, nur bei [own]
  final String? pack;

  /// Nachtkarte: ein Pfadteil der Adresse endet auf `-nacht`. Die Kacheln sind dann schon dunkel.
  bool get night => isNightTiles(url);

  bool get isDefault => url == osmTileTemplate;
}

const _osm = TileSource(url: osmTileTemplate);

final _placeholder = RegExp(r'\{([^{}]*)\}');
final _scheme = RegExp(r'^[a-z][a-z0-9+.-]*:', caseSensitive: false);
final _authority = RegExp(r'^(https?://[^/?#]+)', caseSensitive: false);

/// Löst `settings.map.tiles` gegen die Server-Adresse auf, so wie Medien (`Api.mediaUri`).
///
/// Ohne Schema gilt die Adresse ab dem Basispfad des Servers, mit `http(s)://` ist sie vollständig. `{z}`, `{x}`
/// und `{y}` bleiben unverändert. Fehlt der Wert oder ist er unbrauchbar (Platzhalter fehlen oder sind unbekannt,
/// fremdes Schema, Leerzeichen), gilt OpenStreetMap. Eigen ist eine Adresse, die auf dem Server selbst liegt.
TileSource resolveTiles(String? value, String server) {
  final raw = value?.trim() ?? '';
  if (raw.isEmpty || raw.contains(RegExp(r'\s'))) return _osm;
  final names = [for (final m in _placeholder.allMatches(raw)) m.group(1)!];
  if (!{'z', 'x', 'y'}.every(names.contains) || names.any((n) => !const {'z', 'x', 'y'}.contains(n))) return _osm;
  // Geschweifte Klammern ohne Gegenstück zählen nicht als Platzhalter und ließen sich nicht füllen.
  if (raw.replaceAll(_placeholder, '').contains(RegExp(r'[{}]'))) return _osm;
  final base = server.trim().endsWith('/') ? server.trim().substring(0, server.trim().length - 1) : server.trim();
  final String url;
  if (_scheme.hasMatch(raw)) {
    if (!raw.toLowerCase().startsWith('http://') && !raw.toLowerCase().startsWith('https://')) return _osm;
    url = raw;
  } else {
    if (raw.startsWith('//') || !Api.isValidServer(base)) return _osm;
    url = '$base/${raw.replaceFirst(RegExp(r'^/+'), '')}';
  }
  if (!_sameOrigin(url, base)) return TileSource(url: url);
  return TileSource(url: url, own: true, pack: _packKey(url));
}

bool _sameOrigin(String url, String server) {
  final a = _authority.firstMatch(url)?.group(1), b = _authority.firstMatch(server)?.group(1);
  if (a == null || b == null) return false;
  final x = Uri.tryParse(a), y = Uri.tryParse(b);
  return x != null && y != null && x.scheme == y.scheme && x.host.toLowerCase() == y.host.toLowerCase() && x.port == y.port;
}

/// Pfadteile einer Vorlage ohne Schema, Host und Anfrage, z. B. [tiles, sieglar, {z}, {x}, {y}.png].
List<String> _pathParts(String url) {
  final noQuery = url.split(RegExp(r'[?#]')).first;
  final path = noQuery.replaceFirst(RegExp(r'^[a-z][a-z0-9+.-]*://[^/]*', caseSensitive: false), '');
  return [
    for (final p in path.split('/'))
      if (p.isNotEmpty) p,
  ];
}

/// Ordnername für die Kacheln auf dem Gerät: der Pfadteil vor `{z}`, z. B. „sieglar“.
String _packKey(String url) {
  final parts = _pathParts(url);
  final i = parts.indexWhere((p) => p.contains('{'));
  final name = (i > 0 ? parts[i - 1] : (parts.isNotEmpty ? parts.last : '')).toLowerCase().replaceAll(RegExp(r'[^a-z0-9-]'), '_');
  return name.isEmpty || name.startsWith('.') ? 'own' : name;
}

/// Ist das ein Nachtpaket (Pfadteil endet auf `-nacht`, z. B. tiles/sieglar-nacht/…)?
bool isNightTiles(String url) => _pathParts(url).any((p) => !p.contains('{') && p.toLowerCase().endsWith('-nacht'));

// -----------------------------------------------------------------------------
// Kachelrechnung (Web-Mercator, wie server/tool/map_pack.py)

/// Eine Kachel: Zoomstufe, Spalte, Zeile.
class TileCoord {
  const TileCoord(this.z, this.x, this.y);
  final int z;
  final int x;
  final int y;

  /// Adresse aus einer Vorlage mit {z}, {x}, {y}
  String fill(String template) => template.replaceAll('{z}', '$z').replaceAll('{x}', '$x').replaceAll('{y}', '$y');

  @override
  bool operator ==(Object other) => other is TileCoord && other.z == z && other.x == x && other.y == y;

  @override
  int get hashCode => Object.hash(z, x, y);

  @override
  String toString() => '$z/$x/$y';
}

/// Kachelkoordinate mit Nachkommastellen.
({double x, double y}) tilePos(double lat, double lon, int z) {
  final n = (1 << z).toDouble();
  final r = lat * math.pi / 180;
  final x = (lon + 180) / 360 * n;
  final y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n;
  return (x: x, y: y);
}

/// Die Kachel, in der ein Punkt liegt.
TileCoord tileAt(GeoPoint p, int z) {
  final pos = tilePos(p.lat, p.lon, z);
  final max = (1 << z) - 1;
  return TileCoord(z, pos.x.floor().clamp(0, max), pos.y.floor().clamp(0, max));
}

double metresPerTile(double lat, int z) => 40075016.686 * math.cos(lat * math.pi / 180) / (1 << z);

/// Alle Kacheln der Stufe [z], die den Kreis um [c] mit [radiusM] berühren.
List<TileCoord> tilesAround(GeoPoint c, double radiusM, int z) {
  final pos = tilePos(c.lat, c.lon, z);
  final r = radiusM / metresPerTile(c.lat, z);
  final max = (1 << z) - 1;
  final out = <TileCoord>[];
  for (var x = (pos.x - r).floor(); x <= (pos.x + r).floor(); x++) {
    for (var y = (pos.y - r).floor(); y <= (pos.y + r).floor(); y++) {
      if (x < 0 || y < 0 || x > max || y > max) continue;
      final nx = pos.x.clamp(x.toDouble(), x + 1.0), ny = pos.y.clamp(y.toDouble(), y + 1.0);
      if (math.sqrt(math.pow(nx - pos.x, 2) + math.pow(ny - pos.y, 2)) <= r) out.add(TileCoord(z, x, y));
    }
  }
  return out;
}

/// Angaben des Kartenpakets (aus `GET /api/tiles`), soweit die App sie braucht.
class TileMeta {
  const TileMeta({this.minZoom, this.maxZoom, this.zoomRadiusM = const {}});

  factory TileMeta.fromJson(Json j) {
    int? zoom(Object? v) => v is num && v >= 0 && v <= 22 ? v.toInt() : null;
    final radii = j['zoomRadiusM'];
    return TileMeta(
      minZoom: zoom(j['minZoom']),
      maxZoom: zoom(j['maxZoom']),
      zoomRadiusM: {
        if (radii is Map)
          for (final e in radii.entries)
            if (int.tryParse('${e.key}') != null && e.value is num && (e.value as num) > 0) int.parse('${e.key}'): (e.value as num).toDouble(),
      },
    );
  }

  final int? minZoom;
  final int? maxZoom;

  /// Engerer Umkreis für einzelne Stufen in Metern
  final Map<int, double> zoomRadiusM;

  Json toJson() => {'minZoom': minZoom, 'maxZoom': maxZoom, 'zoomRadiusM': {for (final e in zoomRadiusM.entries) '${e.key}': e.value}};
}

/// Welche Kacheln die App für ein Spiel vorab lädt.
class TilePlan {
  const TilePlan(this.tiles, {this.dropped = const []});

  /// Von grob nach fein sortiert
  final List<TileCoord> tiles;

  /// Zoomstufen, die wegen des Limits fehlen
  final List<int> dropped;
}

/// Mittelpunkt und Radius des Spielgebiets samt Rand: Mitte des Rechtecks um Grenze, Start und Sammelpunkt,
/// Radius bis zum entferntesten Punkt plus [marginM].
({GeoPoint center, double radius}) gameArea(Field field, {double marginM = prefetchMarginM}) {
  final b = field.boundary;
  final points = <GeoPoint>[];
  if (b.isCircle) {
    final c = b.center;
    final dLat = b.radius / 111320, dLon = b.radius / (111320 * math.cos(c.lat * math.pi / 180));
    points.addAll([GeoPoint(c.lat + dLat, c.lon), GeoPoint(c.lat - dLat, c.lon), GeoPoint(c.lat, c.lon + dLon), GeoPoint(c.lat, c.lon - dLon)]);
  } else {
    points.addAll(b.polygon);
  }
  points.add(field.assemblyPoint.location);
  if (field.start != null) points.add(field.start!);
  final lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
  final center = GeoPoint((lats.reduce(math.min) + lats.reduce(math.max)) / 2, (lons.reduce(math.min) + lons.reduce(math.max)) / 2);
  final kx = 111320 * math.cos(center.lat * math.pi / 180);
  var far = 0.0;
  for (final p in points) {
    far = math.max(far, math.sqrt(math.pow((p.lat - center.lat) * 111320, 2) + math.pow((p.lon - center.lon) * kx, 2)));
  }
  return (center: center, radius: far + marginM);
}

/// Kacheln, die das Spielgebiet samt Rand abdecken: Stufen 14 bis 18 (oder die des Pakets), die feinste nur
/// nahe der Mitte. Wird es zu viel ([maxTiles]), fallen die feinsten Stufen weg; die Karte zeigt sie dann
/// aus der nächstgröberen.
TilePlan planTiles(Game game, {TileMeta? meta, int maxTiles = maxPrefetchTiles, double marginM = prefetchMarginM}) {
  final area = gameArea(game.field, marginM: marginM);
  final from = (meta?.minZoom ?? 14).clamp(0, 18), to = (meta?.maxZoom ?? 18).clamp(from, 18);
  final radii = {...defaultZoomRadiusM, ...?meta?.zoomRadiusM};
  final perZoom = <int, List<TileCoord>>{
    for (var z = from; z <= to; z++) z: tilesAround(area.center, math.min(area.radius, radii[z] ?? area.radius), z),
  };
  final dropped = <int>[];
  var total = perZoom.values.fold(0, (a, l) => a + l.length);
  for (var z = to; z > from && total > maxTiles; z--) {
    total -= perZoom.remove(z)!.length;
    dropped.add(z);
  }
  return TilePlan([for (final l in perZoom.values) ...l], dropped: dropped);
}

// -----------------------------------------------------------------------------
// Ablage auf dem Gerät

/// Kacheln im App-Ordner: `<root>/<paket>/<z>/<x>/<y>.png`. Eine leere Datei `<y>.none` merkt sich,
/// dass der Server die Kachel nicht hat (404), damit nicht jeder Lauf erneut fragt.
class TileStore {
  TileStore(this.root);
  final Directory root;

  File file(String pack, TileCoord c) => File('${root.path}/$pack/${c.z}/${c.x}/${c.y}.png');
  File marker(String pack, TileCoord c) => File('${root.path}/$pack/${c.z}/${c.x}/${c.y}.none');
  File _meta(String pack) => File('${root.path}/$pack/pack.json');

  bool has(String pack, TileCoord c) => file(pack, c).existsSync();
  bool known(String pack, TileCoord c) => has(pack, c) || marker(pack, c).existsSync();

  TileMeta? meta(String pack) {
    try {
      return TileMeta.fromJson(jsonDecode(_meta(pack).readAsStringSync()) as Json);
    } catch (_) {
      return null;
    }
  }

  Future<void> saveMeta(String pack, TileMeta meta) async {
    await _meta(pack).parent.create(recursive: true);
    await _meta(pack).writeAsString(jsonEncode(meta.toJson()));
  }

  Future<void> saveMissing(String pack, TileCoord c) async {
    final f = marker(pack, c);
    await f.parent.create(recursive: true);
    await f.writeAsBytes(const []);
  }
}

/// Stand des Vorabladens der Kacheln.
class TileProgress {
  const TileProgress({this.total = 0, this.done = 0, this.bytes = 0, this.running = false});
  final int total;

  /// Kacheln, die auf dem Gerät liegen oder dem Server unbekannt sind (nicht im Paket)
  final int done;

  /// Größe der gespeicherten Kacheln in Byte
  final int bytes;
  final bool running;

  int get missing => total - done;
  bool get complete => missing <= 0;
  double get fraction => total == 0 ? 1 : done / total;

  TileProgress copyWith({int? done, int? bytes, bool? running}) =>
      TileProgress(total: total, done: done ?? this.done, bytes: bytes ?? this.bytes, running: running ?? this.running);
}

/// Zählt, was vom Plan schon da ist.
TileProgress countTiles(TileStore store, String pack, TilePlan plan, {bool running = false}) {
  var done = 0, bytes = 0;
  for (final t in plan.tiles) {
    final f = store.file(pack, t);
    if (f.existsSync()) {
      done++;
      bytes += f.lengthSync();
    } else if (store.marker(pack, t).existsSync()) {
      done++;
    }
  }
  return TileProgress(total: plan.tiles.length, done: done, bytes: bytes, running: running);
}

/// Die Angaben des Pakets vom Server (`GET /api/tiles`); null, wenn der Server sie nicht liefert.
Future<TileMeta?> fetchTileMeta(Api api, String pack) async {
  try {
    final res = await api.get('/tiles');
    for (final e in (res['items'] as List? ?? const [])) {
      if (e is Map && e['name'] == pack) return TileMeta.fromJson(e.cast<String, dynamic>());
    }
  } catch (_) {}
  return null;
}

/// Lädt die Kacheln des Spielgebiets vom eigenen Server auf das Gerät.
///
/// Nur für [TileSource.own]; für OpenStreetMap wird nie vorab geladen. Bereits vorhandene Kacheln bleiben liegen,
/// ein 404 heißt „nicht im Paket“ und ist kein Fehler. Nach [failuresToStop] Fehlschlägen hintereinander (wohl kein
/// Netz) hört der Lauf auf; der nächste versucht den Rest. [onProgress] meldet den Stand, zuletzt mit `running` false.
Future<TileProgress> prefetchTiles({
  required Api api,
  required TileStore store,
  required TileSource source,
  required Game game,
  required bool Function() cancelled,
  required void Function(TileProgress progress) onProgress,
  int concurrency = 4,
  int maxTiles = maxPrefetchTiles,
  int failuresToStop = 3,
}) async {
  final pack = source.pack;
  if (!source.own || pack == null) return const TileProgress();
  var meta = store.meta(pack);
  var plan = planTiles(game, meta: meta, maxTiles: maxTiles);
  var progress = countTiles(store, pack, plan);
  if (progress.complete) {
    onProgress(progress);
    return progress;
  }
  if (meta == null) {
    // Einmal nach den Angaben des Pakets fragen (Stufen, Umkreis); ohne Antwort gelten die Standardwerte.
    meta = await fetchTileMeta(api, pack);
    if (cancelled()) return progress;
    if (meta != null) {
      await store.saveMeta(pack, meta);
      plan = planTiles(game, meta: meta, maxTiles: maxTiles);
      progress = countTiles(store, pack, plan);
    }
  }
  final queue = ListQueue<TileCoord>.from(plan.tiles.where((t) => !store.known(pack, t)));
  var done = progress.done, bytes = progress.bytes, failedInRow = 0;
  onProgress(progress.copyWith(running: true));

  Future<void> worker() async {
    while (queue.isNotEmpty && failedInRow < failuresToStop && !cancelled()) {
      final tile = queue.removeFirst();
      final file = store.file(pack, tile);
      await file.parent.create(recursive: true);
      switch (await api.fetchFile(tile.fill(source.url), file)) {
        case FetchResult.saved:
          failedInRow = 0;
          done++;
          bytes += file.lengthSync();
        case FetchResult.notFound:
          failedInRow = 0;
          await store.saveMissing(pack, tile);
          done++;
        case FetchResult.failed:
          failedInRow++;
      }
      if (!cancelled()) onProgress(progress.copyWith(done: done, bytes: bytes, running: true));
    }
  }

  await Future.wait([for (var i = 0; i < math.max(1, concurrency); i++) worker()]);
  progress = progress.copyWith(done: done, bytes: bytes);
  if (!cancelled()) onProgress(progress);
  return progress;
}

// -----------------------------------------------------------------------------
// Kartenebene

/// Liest Kacheln erst aus dem Ordner auf dem Gerät und fragt nur sonst das Netz (mit dessen Zwischenspeicher).
///
/// Eine Kachel, die der Server nicht hat, und jeder Fehler beim Laden ergeben eine durchsichtige Kachel
/// statt eines Fehlers; so bleibt die Karte darunter sichtbar.
class OwnTileProvider extends NetworkTileProvider {
  OwnTileProvider({required this.store, required this.pack, super.httpClient, super.cachingProvider}) : super(silenceExceptions: true);

  final TileStore store;
  final String pack;

  @override
  ImageProvider getImageWithCancelLoadingSupport(TileCoordinates coordinates, TileLayer options, Future<void> cancelLoading) {
    final tile = TileCoord(coordinates.z, coordinates.x, coordinates.y);
    final file = store.file(pack, tile);
    if (file.existsSync()) return FileImage(file);
    if (store.marker(pack, tile).existsSync()) return MemoryImage(TileProvider.transparentImage);
    return super.getImageWithCancelLoadingSupport(coordinates, options, cancelLoading);
  }
}
