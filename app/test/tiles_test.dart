// Karte: Adresse der Kacheln, Kachelrechnung, Vorabladen, Ablage auf dem Gerät und die Entscheidung zur Nachtfarbe.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/tiles.dart';
import 'package:lykora/model/game.dart';
import 'package:lykora/ui/design/tokens.dart';
import 'package:lykora/ui/screens/map_view.dart';

import 'support.dart';

const server = 'https://example.org/lykora';
final sieglarJson = jsonDecode(File('../spec/v0.1/examples/nachtigall-sieglar.json').readAsStringSync()) as Map<String, dynamic>;

/// Spiel mit anderer Kartenadresse (null: Eintrag entfernen).
Map<String, dynamic> gameWithTiles(Map<String, dynamic> base, String? tiles) {
  final j = jsonDecode(jsonEncode(base)) as Map<String, dynamic>;
  final map = ((j['settings'] as Map)['map'] ??= <String, dynamic>{}) as Map;
  if (tiles == null) {
    map.remove('tiles');
  } else {
    map['tiles'] = tiles;
  }
  return j;
}

/// Kacheln des mitgelieferten Pakets, wie sie der echte Server ausliefert (404, wo es keine gibt).
bool inSieglarPack(String pack, int z, int x, int y) => File('../server/map-packs/$pack/$z/$x/$y.png').existsSync();

/// Synchron, weil Dateizugriffe in testWidgets nur in runAsync laufen.
Directory tempDir() {
  final dir = Directory.systemTemp.createTempSync('lykora-tiles-');
  addTearDown(() => dir.deleteSync(recursive: true));
  return dir;
}

void main() {
  group('Adresse der Kacheln', () {
    test('relativ wie bei Medien, Platzhalter bleiben unverändert', () {
      final s = resolveTiles('tiles/sieglar/{z}/{x}/{y}.png', server);
      expect(s.url, 'https://example.org/lykora/tiles/sieglar/{z}/{x}/{y}.png');
      expect(s.own, isTrue);
      expect(s.pack, 'sieglar');
      expect(s.night, isFalse);
      expect(s.isDefault, isFalse);
    });

    test('Schrägstriche am Rand: Server mit Schrägstrich, Wert mit Schrägstrich', () {
      expect(resolveTiles('/tiles/sieglar/{z}/{x}/{y}.png', '$server/').url, 'https://example.org/lykora/tiles/sieglar/{z}/{x}/{y}.png');
      expect(resolveTiles('  tiles/sieglar/{z}/{x}/{y}.png ', server).url, 'https://example.org/lykora/tiles/sieglar/{z}/{x}/{y}.png');
    });

    test('vollständige Adresse auf dem eigenen Server ist eigen, eine fremde nicht', () {
      final own = resolveTiles('https://example.org/lykora/tiles/sieglar-nacht/{z}/{x}/{y}.png', server);
      expect(own.own, isTrue);
      expect(own.pack, 'sieglar-nacht');
      expect(own.night, isTrue);
      expect(resolveTiles('https://EXAMPLE.org:443/tiles/a/{z}/{x}/{y}.png', server).own, isTrue, reason: 'Groß/Klein und Standard-Port');
      final foreign = resolveTiles('https://tiles.example.com/{z}/{x}/{y}.png', server);
      expect(foreign.own, isFalse);
      expect(foreign.pack, isNull);
      expect(foreign.url, 'https://tiles.example.com/{z}/{x}/{y}.png');
      expect(resolveTiles('http://example.org/tiles/a/{z}/{x}/{y}.png', server).own, isFalse, reason: 'anderes Schema, anderer Ursprung');
      expect(resolveTiles('https://example.org:8443/tiles/a/{z}/{x}/{y}.png', server).own, isFalse, reason: 'anderer Port');
    });

    test('OpenStreetMap gilt bei fehlendem oder unbrauchbarem Wert', () {
      final bad = <String?>[
        null,
        '',
        '   ',
        'tiles/sieglar/{z}/{x}.png', // {y} fehlt
        'tiles/sieglar/{z}/{x}/{y}/{s}.png', // fremder Platzhalter
        'tiles/sieglar/{z}/{x}/{y}/{',
        'tiles/sieglar/z/x/y.png',
        'javascript:alert({z}{x}{y})',
        'file:///sdcard/{z}/{x}/{y}.png',
        'data:text/plain,{z}{x}{y}',
        'pmtiles://example.org/a.pmtiles?{z}{x}{y}',
        '//evil.example/{z}/{x}/{y}.png',
        'tiles/sieglar/{z}/{x}/{y}.png nebenbei',
      ];
      for (final v in bad) {
        final s = resolveTiles(v, server);
        expect(s.url, osmTileTemplate, reason: '$v');
        expect(s.own, isFalse, reason: '$v');
        expect(s.isDefault, isTrue);
      }
    });

    test('relativer Wert ohne brauchbaren Server fällt auf OpenStreetMap zurück', () {
      expect(resolveTiles('tiles/sieglar/{z}/{x}/{y}.png', '').url, osmTileTemplate);
      expect(resolveTiles('tiles/sieglar/{z}/{x}/{y}.png', 'kein server').url, osmTileTemplate);
    });

    test('OpenStreetMap, ausdrücklich eingetragen, ist nicht eigen', () {
      final s = resolveTiles(osmTileTemplate, server);
      expect(s.own, isFalse);
      expect(s.isDefault, isTrue);
    });

    test('Nachtpaket: Pfadteil endet auf -nacht', () {
      expect(isNightTiles('https://example.org/lykora/tiles/sieglar-nacht/{z}/{x}/{y}.png'), isTrue);
      expect(isNightTiles('tiles/sieglar-nacht/{z}/{x}/{y}.png'), isTrue);
      expect(isNightTiles('https://example.org/tiles/sieglar/{z}/{x}/{y}.png'), isFalse);
      expect(isNightTiles('https://example.org/tiles/nacht/{z}/{x}/{y}.png'), isFalse, reason: 'nur Endung -nacht');
      expect(isNightTiles('https://tiles-nacht.example.org/{z}/{x}/{y}.png'), isFalse, reason: 'Host zählt nicht');
      expect(isNightTiles('https://example.org/tiles/sieglar/{z}/{x}/{y}.png?stil=x-nacht'), isFalse, reason: 'Anfrage zählt nicht');
      expect(isNightTiles(osmTileTemplate), isFalse);
    });
  });

  group('Kachelrechnung', () {
    const center = GeoPoint(50.8070781, 7.1337849);

    test('Sieglar bei Zoom 16 liegt in Kachel 34066/21995', () {
      final t = tileAt(center, 16);
      expect((t.z, t.x, t.y), (16, 34066, 21995));
      expect(t.fill('tiles/sieglar/{z}/{x}/{y}.png'), 'tiles/sieglar/16/34066/21995.png');
    });

    test('Eckfälle: Zoom 0, Datumsgrenze, Pole bleiben im Gitter', () {
      expect(tileAt(const GeoPoint(0, 0), 0).toString(), '0/0/0');
      expect(tileAt(const GeoPoint(0, 0), 1).toString(), '1/1/1');
      expect(tileAt(const GeoPoint(85.05, 179.99999), 3).toString(), '3/7/0');
      expect(tileAt(const GeoPoint(-85.05, -180), 3).toString(), '3/0/7');
    });

    test('Kacheln im Umkreis stimmen mit dem Kartenwerkzeug überein (Paket sieglar)', () {
      // server/map-packs/sieglar/pack.json: z14: 4, z15: 8, z16: 22, z17: 71, z18: 87 (800 m, z18 nur 450 m)
      expect([for (final z in [14, 15, 16, 17]) tilesAround(center, 800, z).length], [4, 8, 22, 71]);
      expect(tilesAround(center, 450, 18).length, 87);
      // und es sind genau die Dateien des Pakets
      for (final z in [14, 15, 16, 17, 18]) {
        for (final t in tilesAround(center, z == 18 ? 450 : 800, z)) {
          expect(inSieglarPack('sieglar', t.z, t.x, t.y), isTrue, reason: '$t');
        }
      }
    });
  });

  group('Plan für ein Spiel', () {
    final game = Game(sieglarJson);

    test('Gebiet: Mitte des Rechtecks, Radius mit 100 m Rand', () {
      final a = gameArea(game.field);
      expect(a.center.lat, closeTo(50.80559, 0.0003));
      expect(a.center.lon, closeTo(7.13299, 0.0003));
      final noMargin = gameArea(game.field, marginM: 0);
      expect(a.radius - noMargin.radius, closeTo(100, 0.001));
      expect(noMargin.radius, inInclusiveRange(150, 400));
    });

    test('Kreis als Spielfeld: Radius plus Rand', () {
      final circle = Game(gameJson);
      final a = gameArea(circle.field);
      expect(a.radius, closeTo(300 + 100, 1));
    });

    test('Stufen 14 bis 18, feinste Stufe nur nahe der Mitte, höchstens 400', () {
      final plan = planTiles(game);
      final byZoom = <int, int>{};
      for (final t in plan.tiles) {
        byZoom[t.z] = (byZoom[t.z] ?? 0) + 1;
      }
      // ignore: avoid_print
      print('Plan Sieglar-Spiel: ${plan.tiles.length} Kacheln, je Stufe $byZoom');
      expect(byZoom.keys.toList()..sort(), [14, 15, 16, 17, 18]);
      expect(plan.tiles.length, lessThanOrEqualTo(maxPrefetchTiles));
      expect(plan.dropped, isEmpty);
      expect(plan.tiles.toSet().length, plan.tiles.length, reason: 'keine doppelten');
      // von grob nach fein
      expect([for (final t in plan.tiles) t.z], [for (final t in plan.tiles) t.z]..sort());
      // der Sammelpunkt liegt auf jeder Stufe im Plan
      final assembly = game.field.assemblyPoint.location;
      for (final z in [14, 15, 16, 17, 18]) {
        expect(plan.tiles, contains(tileAt(assembly, z)), reason: 'z$z');
      }
      // die Mitte jeder Stufe-18-Kachel liegt höchstens 450 m + eine Kachel von der Mitte
      final area = gameArea(game.field);
      for (final t in plan.tiles.where((t) => t.z == 18)) {
        final p = tilePos(area.center.lat, area.center.lon, 18);
        final dx = (t.x + 0.5 - p.x).abs() * metresPerTile(area.center.lat, 18), dy = (t.y + 0.5 - p.y).abs() * metresPerTile(area.center.lat, 18);
        expect(dx * dx + dy * dy, lessThan(sq(450 + 100 * 1.5)), reason: '$t');
      }
    });

    test('zu viele Kacheln: die feinsten Stufen fallen weg', () {
      final all = planTiles(game).tiles.length;
      final plan = planTiles(game, maxTiles: all - 1);
      expect(plan.dropped, [18]);
      expect(plan.tiles.every((t) => t.z <= 17), isTrue);
      final tiny = planTiles(game, maxTiles: 1);
      expect(tiny.tiles.map((t) => t.z).toSet(), {14}, reason: 'die gröbste Stufe bleibt immer');
      expect(tiny.dropped, [18, 17, 16, 15]);
    });

    test('Angaben des Pakets begrenzen die Stufen und den Umkreis', () {
      final meta = TileMeta.fromJson({
        'minZoom': 15,
        'maxZoom': 17,
        'zoomRadiusM': {'17': 150},
      });
      final plan = planTiles(game, meta: meta);
      expect(plan.tiles.map((t) => t.z).toSet(), {15, 16, 17});
      final full = planTiles(game, meta: const TileMeta(minZoom: 15, maxZoom: 17));
      expect(plan.tiles.length, lessThan(full.tiles.length));
      expect(TileMeta.fromJson({'minZoom': 99, 'zoomRadiusM': 'x'}).minZoom, isNull);
      expect(TileMeta.fromJson(meta.toJson()).zoomRadiusM, {17: 150.0});
    });
  });

  group('Vorabladen', () {
    late FakeServer fake;
    late Directory dir;
    late TileStore store;
    late Api api;
    final game = Game(sieglarJson);
    final source = resolveTiles('tiles/sieglar/{z}/{x}/{y}.png', server);

    setUp(() async {
      fake = FakeServer(game: sieglarJson)..hasTile = inSieglarPack;
      dir = tempDir();
      store = TileStore(dir);
      api = Api(server, client: fake.client());
    });

    Future<TileProgress> run({bool Function()? cancelled, TileSource? src, List<TileProgress>? seen}) => prefetchTiles(
      api: api,
      store: store,
      source: src ?? source,
      game: game,
      cancelled: cancelled ?? () => false,
      onProgress: (p) => seen?.add(p),
    );

    test('lädt alle Kacheln des Plans, was das Paket nicht hat, gilt als „nicht im Paket“', () async {
      final seen = <TileProgress>[];
      final p = await run(seen: seen);
      final plan = planTiles(game);
      final inPack = plan.tiles.where((t) => inSieglarPack('sieglar', t.z, t.x, t.y)).length;
      // ignore: avoid_print
      print('Vorabladen Sieglar-Spiel: ${plan.tiles.length} geplant, $inPack im Paket, ${p.bytes} Byte (Testkacheln), ${plan.tiles.length - inPack} nicht im Paket');
      expect(p.total, plan.tiles.length);
      expect(p.done, p.total);
      expect(p.complete, isTrue);
      expect(p.running, isFalse);
      expect(p.bytes, inPack * FakeServer.tileBytes.length);
      expect(fake.tileRequests.length, plan.tiles.length);
      expect(fake.calls, contains('GET /tiles'), reason: 'einmal nach den Angaben des Pakets gefragt');
      for (final t in plan.tiles) {
        expect(store.known('sieglar', t), isTrue);
        expect(store.has('sieglar', t), inSieglarPack('sieglar', t.z, t.x, t.y));
      }
      expect(File('${dir.path}/sieglar/16/34066/21995.png').existsSync(), plan.tiles.contains(const TileCoord(16, 34066, 21995)));
      // Fortschritt wächst Schritt für Schritt und endet ohne running
      expect(seen.where((s) => s.running).length, greaterThan(plan.tiles.length ~/ 2));
      expect(seen.last.running, isFalse);
      expect([for (final s in seen) s.done], [for (final s in seen) s.done]..sort());
    });

    test('vorhandene Kacheln und bekannte Lücken werden übersprungen', () async {
      await run();
      fake.tileRequests.clear();
      fake.calls.clear();
      final p = await run();
      expect(p.complete, isTrue);
      expect(fake.tileRequests, isEmpty);
      expect(fake.calls, isEmpty, reason: 'auch keine Frage nach den Angaben des Pakets');
    });

    test('ein halber Bestand wird ergänzt', () async {
      await run();
      final plan = planTiles(game);
      final have = plan.tiles.firstWhere((t) => store.has('sieglar', t));
      store.file('sieglar', have).deleteSync();
      fake.tileRequests.clear();
      final p = await run();
      expect(fake.tileRequests, ['/lykora/tiles/sieglar/${have.z}/${have.x}/${have.y}.png']);
      expect(p.complete, isTrue);
    });

    test('nur vier Anfragen gleichzeitig', () async {
      var running = 0, most = 0, total = 0;
      api = Api(
        server,
        client: MockClient((req) async {
          if (!req.url.path.contains('/tiles/')) return http.Response('{"error":"x"}', 404, headers: {'content-type': 'application/json'});
          total++;
          running++;
          if (running > most) most = running;
          await Future<void>.delayed(const Duration(milliseconds: 3));
          running--;
          return http.Response.bytes(FakeServer.tileBytes, 200, headers: {'content-type': 'image/png'});
        }),
      );
      final p = await run();
      expect(p.complete, isTrue);
      expect(total, p.total);
      expect(most, 4);
    });

    test('ohne Netz: nach drei Fehlschlägen in Folge Schluss, nichts wird als Lücke gemerkt, später geht es weiter', () async {
      fake.online = false;
      final p = await run();
      expect(p.done, 0);
      expect(p.complete, isFalse);
      expect(p.running, isFalse);
      expect(dir.listSync(recursive: true).whereType<File>(), isEmpty, reason: 'weder Kacheln noch Lücken-Marken ohne Antwort');
      fake.online = true;
      final again = await run();
      expect(again.complete, isTrue);
      expect(again.total, p.total);
    });

    test('Fehler 500 und Anmeldeseite sind Fehler, keine Lücken', () async {
      fake.captivePortal = true;
      expect((await run()).done, 0);
      fake.captivePortal = false;
      final plan = planTiles(game);
      final first = plan.tiles.first;
      fake.fail('/lykora/tiles/sieglar/${first.z}/${first.x}/${first.y}.png', 500);
      final p = await run();
      expect(p.done, p.total - 1);
      expect(store.known('sieglar', first), isFalse);
      fake.heal();
      expect((await run()).complete, isTrue);
    });

    test('Angaben des Pakets werden gemerkt und bestimmen die Stufen', () async {
      fake.tilePacks = [
        {'name': 'andere', 'minZoom': 1},
        {
          'name': 'sieglar',
          'title': 'Sieglar',
          'minZoom': 15,
          'maxZoom': 17,
          'zoomRadiusM': {'18': 450},
        },
      ];
      final p = await run();
      expect(store.meta('sieglar')?.minZoom, 15);
      expect(store.meta('sieglar')?.maxZoom, 17);
      expect(p.total, planTiles(game, meta: store.meta('sieglar')).tiles.length);
      expect(fake.tileRequests.any((r) => r.contains('/sieglar/14/') || r.contains('/sieglar/18/')), isFalse);
    });

    test('abgebrochen: keine Anfrage', () async {
      await run(cancelled: () => true);
      expect(fake.tileRequests, isEmpty);
    });

    test('nie von OpenStreetMap oder fremden Servern', () async {
      var calls = 0;
      api = Api(
        server,
        client: MockClient((req) async {
          calls++;
          return http.Response.bytes(FakeServer.tileBytes, 200);
        }),
      );
      for (final v in [null, osmTileTemplate, 'https://tiles.example.com/{z}/{x}/{y}.png']) {
        final p = await run(src: resolveTiles(v, server));
        expect(p.total, 0, reason: '$v');
      }
      expect(calls, 0);
      expect(dir.listSync(), isEmpty);
    });

    test('Anzahl und Größe des Pakets im Normalfall', () async {
      // Größe aus dem echten Paket: nur die Kacheln, die das Spiel braucht
      final plan = planTiles(game);
      var bytes = 0, nightBytes = 0, n = 0;
      for (final t in plan.tiles) {
        final f = File('../server/map-packs/sieglar/${t.z}/${t.x}/${t.y}.png');
        if (f.existsSync()) {
          n++;
          bytes += f.lengthSync();
          nightBytes += File('../server/map-packs/sieglar-nacht/${t.z}/${t.x}/${t.y}.png').lengthSync();
        }
      }
      // ignore: avoid_print
      print('Sieglar-Spiel: ${plan.tiles.length} geplant, $n im Paket, Tag $bytes Byte, Nacht $nightBytes Byte');
      expect(n, greaterThan(0));
      expect(plan.tiles.length, lessThanOrEqualTo(maxPrefetchTiles));
    });
  });

  group('Kacheln vom Gerät', () {
    final layer = TileLayer(urlTemplate: 'https://example.org/lykora/tiles/sieglar/{z}/{x}/{y}.png');
    const coords = TileCoordinates(34066, 21995, 16);

    OwnTileProvider provider(TileStore store, {http.Client? client}) => OwnTileProvider(
      store: store,
      pack: 'sieglar',
      httpClient: client ?? MockClient((_) async => throw const SocketException('offline')),
      cachingProvider: const DisabledMapCachingProvider(),
    );

    test('liegt die Kachel im Ordner, kommt sie von dort, auch ohne Netz', () async {
      final dir = tempDir();
      final store = TileStore(dir);
      final f = store.file('sieglar', const TileCoord(16, 34066, 21995));
      f.parent.createSync(recursive: true);
      f.writeAsBytesSync(FakeServer.tileBytes);
      final image = provider(store).getImageWithCancelLoadingSupport(coords, layer, Completer<void>().future);
      expect(image, isA<FileImage>());
      expect((image as FileImage).file.path, f.path);
    });

    test('eine gemerkte Lücke ergibt eine durchsichtige Kachel ohne Anfrage', () async {
      final dir = tempDir();
      final store = TileStore(dir);
      await store.saveMissing('sieglar', const TileCoord(16, 34066, 21995));
      var asked = 0;
      final p = provider(
        store,
        client: MockClient((_) async {
          asked++;
          return http.Response('', 404);
        }),
      );
      final image = p.getImageWithCancelLoadingSupport(coords, layer, Completer<void>().future);
      expect(image, isA<MemoryImage>());
      expect(asked, 0);
    });

    /// Lädt das Bild des Anbieters; Fehler und Bild kommen zurück.
    Future<(ui.Image?, Object?)> load(WidgetTester tester, ImageProvider image) => tester.runAsync(() async {
      final done = Completer<(ui.Image?, Object?)>();
      image.resolve(ImageConfiguration.empty).addListener(ImageStreamListener((info, _) => done.complete((info.image, null)), onError: (e, _) => done.complete((null, e))));
      return done.future.timeout(const Duration(seconds: 10));
    }).then((r) => r!);

    testWidgets('liegt die Kachel im Ordner, wird sie auch ohne Netz geladen', (tester) async {
      final dir = tempDir();
      final store = TileStore(dir);
      final f = store.file('sieglar', const TileCoord(16, 34066, 21995));
      f.parent.createSync(recursive: true);
      f.writeAsBytesSync(FakeServer.tileBytes);
      final image = provider(store).getImageWithCancelLoadingSupport(coords, layer, Completer<void>().future);
      final (img, error) = await load(tester, image);
      expect(error, isNull);
      expect(img?.width, 1);
    });

    testWidgets('fehlt die Kachel und das Netz, ergibt das eine durchsichtige Kachel statt eines Fehlers', (tester) async {
      final dir = tempDir();
      final image = provider(TileStore(dir)).getImageWithCancelLoadingSupport(coords, layer, Completer<void>().future);
      expect(image, isNot(isA<FileImage>()));
      final (img, error) = await load(tester, image);
      expect(error, isNull);
      expect(img, isNotNull);
    });

    testWidgets('404 des Servers ist ebenfalls keine Fehlermeldung', (tester) async {
      final dir = tempDir();
      final client = MockClient((_) async => http.Response('{"error":"not_found"}', 404, headers: {'content-type': 'application/json'}));
      final image = provider(TileStore(dir), client: client).getImageWithCancelLoadingSupport(coords, layer, Completer<void>().future);
      final (img, error) = await load(tester, image);
      expect(error, isNull);
      expect(img, isNotNull);
    });
  });

  group('Nachtfarbe der Kacheln', () {
    test('Tageskacheln: nachts invertiert, tagsüber unverändert', () {
      expect(tileFilterFor(LightMode.day), isNull);
      expect(tileFilterFor(LightMode.night), isNotNull);
      expect(tileFilterFor(LightMode.amber), isNotNull);
      expect(tileFilterFor(LightMode.red), isNotNull);
    });

    test('Nachtpaket: nicht invertieren, nur Bernstein tönt', () {
      expect(tileFilterFor(LightMode.night, nightTiles: true), isNull);
      expect(tileFilterFor(LightMode.day, nightTiles: true), isNull);
      expect(tileFilterFor(LightMode.red, nightTiles: true), isNull);
      final amber = tileFilterFor(LightMode.amber, nightTiles: true);
      expect(amber, isNotNull);
      expect(amber, isNot(tileFilterFor(LightMode.amber)), reason: 'nicht der invertierende Filter');
    });

    test('die Entscheidung folgt der Adresse', () {
      bool filtered(String v) => tileFilterFor(LightMode.night, nightTiles: resolveTiles(v, server).night) != null;
      expect(filtered('tiles/sieglar/{z}/{x}/{y}.png'), isTrue);
      expect(filtered('tiles/sieglar-nacht/{z}/{x}/{y}.png'), isFalse);
      expect(filtered(osmTileTemplate), isTrue);
    });
  });
}

double sq(double metres) => metres * metres;
