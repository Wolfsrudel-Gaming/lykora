// Karte im Spiel: Kacheln beim Beitritt vorab laden, aufräumen, und die Ebenen der Karte je nach Paket und Lichtmodus.

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/data/tiles.dart';
import 'package:lykora/ui/design/tokens.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';

import 'support.dart';

const address = 'https://example.org/lykora';
final sieglar = jsonDecode(File('../spec/v0.1/examples/nachtigall-sieglar.json').readAsStringSync()) as Map<String, dynamic>;

Map<String, dynamic> withTiles(Map<String, dynamic> base, String? tiles) {
  final j = jsonDecode(jsonEncode(base)) as Map<String, dynamic>;
  final settings = j['settings'] as Map<String, dynamic>;
  final map = (settings['map'] ??= <String, dynamic>{}) as Map<String, dynamic>;
  if (tiles == null) {
    map.remove('tiles');
  } else {
    map['tiles'] = tiles;
  }
  return j;
}

bool inPack(String pack, int z, int x, int y) => File('../server/map-packs/$pack/$z/$x/$y.png').existsSync();

void main() {
  group('Kacheln beim Beitritt', () {
    late Directory dir;
    setUp(() async {
      dir = await Directory.systemTemp.createTemp('lykora-maptiles-');
      addTearDown(() => dir.delete(recursive: true));
    });

    Future<(GameController, FakeServer)> joined(Map<String, dynamic> game, {void Function(FakeServer)? prepare}) async {
      final server = FakeServer(game: game)..hasTile = inPack;
      prepare?.call(server);
      final c = controllerFor(server, dir);
      await c.join(server: address, code: 'K7M2QX', teamName: 'Füchse');
      addTearDown(c.dispose);
      return (c, server);
    }

    test('lädt Medien und Kacheln, Fortschritt „Karte n von m“ ist vollständig', () async {
      final server = FakeServer(game: sieglar)..hasTile = inPack;
      final c = controllerFor(server, dir);
      addTearDown(c.dispose);
      final seen = <TileProgress>[];
      c.tileProgress.addListener(() => seen.add(c.tileProgress.value));
      await c.join(server: address, code: 'K7M2QX', teamName: 'Füchse');
      final p = c.tileProgress.value;
      expect(p.total, 82);
      expect(p.done, 82);
      expect(p.complete, isTrue);
      expect(p.running, isFalse);
      expect(p.bytes, greaterThan(0));
      expect(tileProgressText(seen[seen.length ~/ 2]), matches(RegExp(r'^Karte \d+ von 82$')));
      expect(c.mediaProgress.value.complete, isTrue);
      expect(File('${dir.path}/tiles/sieglar/16/34066/21995.png').existsSync(), isTrue);
      expect(server.tileRequests.every((r) => r.startsWith('/lykora/tiles/sieglar/')), isTrue);
      expect(c.tileSource.own, isTrue);
      expect(c.tileMinZoom, isNull, reason: 'der Server hat keine Angaben zum Paket geliefert');
    });

    test('die kleinste Stufe kommt aus den Angaben des Pakets', () async {
      final (c, _) = await joined(sieglar, prepare: (s) => s.tilePacks = [{'name': 'sieglar', 'minZoom': 14, 'maxZoom': 18}]);
      expect(c.tileMinZoom, 14);
      // und nach einem Neustart aus dem Ordner
      final again = controllerFor(FakeServer(game: sieglar), dir);
      addTearDown(again.dispose);
      await again.load();
      expect(again.tileMinZoom, 14);
      expect(again.tileProgress.value.complete, isTrue);
    });

    test('Kacheln, die das Paket nicht hat, sind kein Fehler', () async {
      final (c, server) = await joined(sieglar);
      expect(c.tileProgress.value.complete, isTrue);
      expect(Directory('${dir.path}/tiles/sieglar').listSync(recursive: true).where((e) => e.path.endsWith('.none')), hasLength(2));
      server.tileRequests.clear();
      await c.retryMedia();
      expect(server.tileRequests, isEmpty, reason: 'Lücken werden nicht noch einmal erfragt');
    });

    test('Fehlschläge blockieren nichts; „Nochmal laden“ holt den Rest', () async {
      final server = FakeServer(game: sieglar)..hasTile = inPack;
      server.fail('/lykora/tiles/sieglar/16/34066/21995.png', 500);
      final c = controllerFor(server, dir);
      addTearDown(c.dispose);
      await c.join(server: address, code: 'K7M2QX', teamName: 'Füchse');
      expect(c.hasGame, isTrue);
      expect(c.mediaProgress.value.complete, isTrue);
      expect(c.tileProgress.value.missing, 1);
      expect(c.tileProgress.value.running, isFalse);
      server.heal();
      await c.retryMedia();
      expect(c.tileProgress.value.complete, isTrue);
      expect(File('${dir.path}/tiles/sieglar/16/34066/21995.png').existsSync(), isTrue);
    });

    test('ohne Netz fehlen die Kacheln, das Spiel läuft; Rückkehr in die App holt sie nach', () async {
      final server = FakeServer(game: sieglar)..hasTile = inPack;
      final first = controllerFor(server, dir);
      await first.join(server: address, code: 'K7M2QX', teamName: 'Füchse', awaitMedia: false);
      await first.waitForMedia();
      expect(first.tileProgress.value.complete, isTrue);
      first.dispose();
      // Neustart der App ohne Kacheln und ohne Netz
      await Directory('${dir.path}/tiles').delete(recursive: true);
      final c = controllerFor(server, dir);
      addTearDown(c.dispose);
      await c.load();
      expect(c.tileProgress.value.done, 0);
      expect(c.tileProgress.value.total, 82);
      server.online = false;
      await c.retryMedia();
      expect(c.tileProgress.value.done, 0);
      expect(c.tileProgress.value.running, isFalse);
      expect(c.hasGame, isTrue);
      server.online = true;
      c.onAppResumed();
      await c.waitForMedia();
      expect(c.tileProgress.value.complete, isTrue);
    });

    test('Team verlassen löscht die Kacheln', () async {
      final (c, _) = await joined(sieglar);
      expect(Directory('${dir.path}/tiles').existsSync(), isTrue);
      await c.leave();
      expect(Directory('${dir.path}/tiles').existsSync(), isFalse);
      expect(c.tileProgress.value.total, 0);
      expect(c.tileMinZoom, isNull);
    });

    test('ohne eigene Kacheln im Spiel: nichts wird vorab geladen', () async {
      for (final tiles in [null, osmTileTemplate, 'https://tiles.example.com/{z}/{x}/{y}.png', 'kaputt']) {
        final server = FakeServer(game: withTiles(sieglar, tiles))..hasTile = inPack;
        final sub = await Directory.systemTemp.createTemp('lykora-maptiles-');
        addTearDown(() => sub.delete(recursive: true));
        final c = controllerFor(server, sub);
        addTearDown(c.dispose);
        await c.join(server: address, code: 'K7M2QX', teamName: 'Füchse');
        expect(c.tileProgress.value.total, 0, reason: '$tiles');
        expect(c.tileSource.own, isFalse, reason: '$tiles');
        expect(server.calls.where((x) => x.contains('/tiles')), isEmpty, reason: '$tiles');
        expect(server.calls.where((x) => x.endsWith('.png')), isEmpty, reason: '$tiles');
        expect(Directory('${sub.path}/tiles').existsSync(), isFalse, reason: '$tiles');
      }
    });

    test('Nachtpaket wird als Nachtpaket erkannt und ebenfalls vorab geladen', () async {
      final (c, server) = await joined(withTiles(sieglar, 'tiles/sieglar-nacht/{z}/{x}/{y}.png'));
      expect(c.tileSource.night, isTrue);
      expect(c.tileProgress.value.complete, isTrue);
      expect(server.tileRequests.every((r) => r.startsWith('/lykora/tiles/sieglar-nacht/')), isTrue);
      expect(File('${dir.path}/tiles/sieglar-nacht/16/34066/21995.png').existsSync(), isTrue);
    });
  });

  group('Karte', () {
    late FakeServer server;

    setUpAll(() async {
      await loadAppFonts();
      GameMap.showTiles = true;
      // Der Zwischenspeicher der Karte braucht das Plugin für den App-Ordner, das es im Test nicht gibt.
      GameMap.cachingProvider = const DisabledMapCachingProvider();
    });
    tearDownAll(() {
      GameMap.showTiles = false;
      GameMap.cachingProvider = null;
    });

    Future<(GameController, AppSettings)> setup(WidgetTester tester, String? tiles, LightMode mode, {List<Map<String, dynamic>>? packs}) async {
      tester.view.physicalSize = const Size(1236, 2745);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      server = FakeServer(game: withTiles(sieglar, tiles))..tilePacks = packs;
      late GameController c;
      late AppSettings s;
      await tester.runAsync(() async {
        final dir = await Directory.systemTemp.createTemp('lykora-mapw-');
        final store = SessionStore(dir);
        c = GameController(store: store, apiFactory: (a, t) => Api(a, token: t, client: server.client()), backgroundLoops: false);
        await c.join(server: address, code: 'K7M2QX', teamName: 'Füchse');
        s = AppSettings(store)..lightMode = mode;
      });
      return (c, s);
    }

    Future<void> show(WidgetTester tester, GameController c, AppSettings s) async {
      await tester.pumpWidget(
        Lykora(
          controller: c,
          settings: s,
          child: MaterialApp(theme: buildTheme(s.tokensFor(c.game)), home: const Scaffold(body: GameMap())),
        ),
      );
      for (var i = 0; i < 4; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    Finder filtered() => find.descendant(of: find.byType(FlutterMap), matching: find.byType(ColorFiltered));
    List<int> nativeZooms(WidgetTester tester) => [for (final l in tester.widgetList<TileLayer>(find.byType(TileLayer))) l.maxNativeZoom];

    testWidgets('eigene Kacheln: Stufe 17 darunter, Stufe 18 darüber, Nachts invertiert', (tester) async {
      final (c, s) = await setup(tester, 'tiles/sieglar/{z}/{x}/{y}.png', LightMode.night);
      await show(tester, c, s);
      expect(nativeZooms(tester), [17, 18]);
      final layers = tester.widgetList<TileLayer>(find.byType(TileLayer)).toList();
      expect(layers.every((l) => l.urlTemplate == 'https://example.org/lykora/tiles/sieglar/{z}/{x}/{y}.png'), isTrue);
      expect(layers.every((l) => l.tileProvider is OwnTileProvider), isTrue);
      expect(filtered(), findsOneWidget);
      expect(find.text('© OpenStreetMap-Mitwirkende'), findsOneWidget);
    });

    testWidgets('Nachtpaket: kein invertierender Filter', (tester) async {
      final (c, s) = await setup(tester, 'tiles/sieglar-nacht/{z}/{x}/{y}.png', LightMode.night);
      await show(tester, c, s);
      expect(nativeZooms(tester), [17, 18]);
      expect(filtered(), findsNothing);
    });

    testWidgets('Nachtpaket in Bernstein: nur Tönung', (tester) async {
      final (c, s) = await setup(tester, 'tiles/sieglar-nacht/{z}/{x}/{y}.png', LightMode.amber);
      await show(tester, c, s);
      expect(filtered(), findsOneWidget);
    });

    testWidgets('Tag: nie ein Filter', (tester) async {
      final (c, s) = await setup(tester, 'tiles/sieglar/{z}/{x}/{y}.png', LightMode.day);
      await show(tester, c, s);
      expect(nativeZooms(tester), [17, 18]);
      expect(filtered(), findsNothing);
    });

    testWidgets('Rotlicht: keine Kacheln, keine Zuschreibung', (tester) async {
      final (c, s) = await setup(tester, 'tiles/sieglar/{z}/{x}/{y}.png', LightMode.red);
      await show(tester, c, s);
      expect(find.byType(TileLayer), findsNothing);
      expect(find.text('© OpenStreetMap-Mitwirkende'), findsNothing);
    });

    testWidgets('ohne Eintrag: OpenStreetMap wie bisher, eine Ebene, Stufe 19, invertiert', (tester) async {
      final (c, s) = await setup(tester, null, LightMode.night);
      await show(tester, c, s);
      expect(nativeZooms(tester), [19]);
      expect(tester.widget<TileLayer>(find.byType(TileLayer)).urlTemplate, osmTileTemplate);
      expect(tester.widget<TileLayer>(find.byType(TileLayer)).tileProvider, isNot(isA<OwnTileProvider>()));
      expect(filtered(), findsOneWidget);
      expect(find.text('© OpenStreetMap-Mitwirkende'), findsOneWidget);
    });

    testWidgets('Zuschreibung öffnet die Lizenzseite', (tester) async {
      final (c, s) = await setup(tester, null, LightMode.day);
      final opened = <Uri>[];
      final before = MapAttribution.open;
      MapAttribution.open = (uri) async => opened.add(uri);
      addTearDown(() => MapAttribution.open = before);
      await show(tester, c, s);
      await tester.tap(find.text('© OpenStreetMap-Mitwirkende'));
      expect(opened, [Uri.parse('https://www.openstreetmap.org/copyright')]);
    });

    testWidgets('Kartenpaket: kleinste Stufe der Karte folgt dem Paket', (tester) async {
      final (c, s) = await setup(tester, 'tiles/sieglar/{z}/{x}/{y}.png', LightMode.night);
      await show(tester, c, s);
      expect(tester.widget<FlutterMap>(find.byType(FlutterMap)).options.minZoom, 13, reason: 'ohne Angaben bleibt es bei 13');
    });

    testWidgets('mit Angaben des Pakets liegt die kleinste Stufe bei 14', (tester) async {
      final (c, s) = await setup(tester, 'tiles/sieglar/{z}/{x}/{y}.png', LightMode.night, packs: [{'name': 'sieglar', 'minZoom': 14, 'maxZoom': 18}]);
      await show(tester, c, s);
      expect(tester.widget<FlutterMap>(find.byType(FlutterMap)).options.minZoom, 14);
    });

    testWidgets('OpenStreetMap behält die kleinste Stufe 13', (tester) async {
      final (c, s) = await setup(tester, null, LightMode.night);
      await show(tester, c, s);
      expect(tester.widget<FlutterMap>(find.byType(FlutterMap)).options.minZoom, 13);
    });
  });
}
