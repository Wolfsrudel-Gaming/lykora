// Sicherheitsleiste: SOS bleibt in jeder Enge voll im Bild und tippbar; Lebenszeichen meldet sich einmal.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/services/fx.dart';
import 'package:lykora/ui/design/tokens.dart';
import 'package:lykora/ui/safety/sos_screen.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';

import 'support.dart';

late FakeServer server;
final errors = <String>[];

/// Spiel im Lauf; [clock] liefert die Geräteuhr, damit ein Test die Zeit vorstellen kann.
Future<(GameController, AppSettings)> _setup(WidgetTester tester, {required double width, int Function()? clock}) async {
  // Fehler sammeln statt abbrechen: Überläufe anderer Bildschirme (Home) gehören nicht zu diesen Tests.
  errors.clear();
  FlutterError.onError = (d) {
    final where = RegExp(r'(lib/[a-z_/]+\.dart:\d+)').firstMatch(d.toString())?.group(1);
    errors.add('${d.exceptionAsString().split('\n').first} @ $where');
  };
  tester.view.physicalSize = Size(width * 3, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  server = FakeServer();
  late GameController c;
  late AppSettings settings;
  await tester.runAsync(() async {
    final dir = await Directory.systemTemp.createTemp('lykora-bar-');
    final store = SessionStore(dir);
    c = GameController(
      store: store,
      apiFactory: (s, t) => Api(s, token: t, client: server.client()),
      backgroundLoops: false,
      clock: clock,
    );
    await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
    await c.start();
    await c.markIntroSeen();
    settings = AppSettings(store);
  });
  return (c, settings);
}

Future<void> _settle(WidgetTester tester, [int frames = 6]) async {
  for (var i = 0; i < frames; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 15)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUpAll(() async {
    await loadAppFonts();
    GameMap.showTiles = false;
    PrepScreen.skipPacking = true;
  });

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized().defaultBinaryMessenger.setMockStreamHandler(
      const EventChannel('com.llfbandit.app_links/events'),
      MockStreamHandler.inline(onListen: (_, _) {}),
    );
  });

  group('Sicherheitsleiste: SOS bleibt im Bild', () {
    for (final width in [320.0, 360.0, 412.0]) {
      for (final scale in [1.0, 1.6, 2.0]) {
        for (final mode in [LightMode.night, LightMode.red]) {
          testWidgets('Akku 12 %, offline, 5 offen: Breite $width, Schrift $scale, ${mode.name}', (tester) async {
            final (c, s) = await _setup(tester, width: width);
            await tester.runAsync(() async {
              for (var i = 0; i < 5; i++) {
                await c.heartbeat();
              }
              server.online = false;
              await c.sync();
            });
            expect(c.online, isFalse);
            expect(c.unsyncedCount, greaterThanOrEqualTo(5));
            c.battery = 0.12;
            s.lightMode = mode;
            s.textScale = scale;
            tester.platformDispatcher.textScaleFactorTestValue = scale;
            addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
            await tester.pumpWidget(LykoraApp(controller: c, settings: s));
            await _settle(tester);

            expect(errors.where((e) => e.contains('ui/safety/')), isEmpty, reason: 'kein Überlauf in der Leiste');
            final sos = find.text('SOS').first;
            final r = tester.getRect(sos);
            final screen = Offset.zero & Size(width, 2400 / 3);
            expect(screen.contains(r.topLeft) && screen.contains(r.bottomRight), isTrue, reason: 'SOS voll im Bild: $r');
            // Tippfläche der Taste: mindestens 48 dp hoch, mindestens 56 dp breit, ganz im Bild.
            final key = tester.getRect(find.ancestor(of: sos, matching: find.byType(GestureDetector)).first);
            expect(key.width, greaterThanOrEqualTo(56));
            expect(key.height, greaterThanOrEqualTo(48));
            expect(key.right, lessThanOrEqualTo(width));
            expect(sos.hitTestable(), findsOneWidget);

            await tester.tap(sos);
            await _settle(tester);
            expect(find.byType(SosScreen), findsOneWidget, reason: 'Tippen öffnet die SOS-Seite');
          });
        }
      }
    }

    testWidgets('Anzeige und Lichtschalter lassen SOS Platz und sind ≥ 48 dp hoch', (tester) async {
      final (c, s) = await _setup(tester, width: 320);
      await tester.runAsync(() async {
        for (var i = 0; i < 5; i++) {
          await c.heartbeat();
        }
        server.online = false;
        await c.sync();
      });
      c.battery = 0.12;
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester);
      final sos = tester.getRect(find.text('SOS').first);
      final chip = tester.getRect(find.byIcon(Icons.portable_wifi_off_rounded));
      final light = tester.getRect(find.byIcon(Icons.nightlight_round));
      expect(chip.right, lessThanOrEqualTo(sos.left), reason: 'Anzeige überlappt SOS nicht');
      expect(light.right, lessThanOrEqualTo(chip.left));
      for (final icon in [Icons.nightlight_round, Icons.portable_wifi_off_rounded]) {
        final hit = find.ancestor(of: find.byIcon(icon), matching: find.byType(GestureDetector)).first;
        expect(tester.getSize(hit).height, greaterThanOrEqualTo(48), reason: '$icon');
      }
    });

    testWidgets('Antippen der Anzeige zeigt Einzelheiten, SOS bleibt stehen', (tester) async {
      final (c, s) = await _setup(tester, width: 360);
      await tester.runAsync(() async {
        await c.heartbeat();
        await c.heartbeat();
        server.online = false;
        await c.sync();
      });
      c.battery = 0.2;
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester);
      final before = tester.getRect(find.text('SOS').first);
      expect(find.textContaining('Kein Netz.'), findsNothing);
      await tester.tap(find.byIcon(Icons.portable_wifi_off_rounded));
      await _settle(tester);
      expect(find.textContaining('Kein Netz.'), findsOneWidget);
      expect(find.textContaining(RegExp(r'\d+ Aktionen warten')), findsOneWidget);
      expect(find.textContaining('Akku bei 20 %'), findsOneWidget);
      expect(tester.getRect(find.text('SOS').first), before);
      await tester.tap(find.textContaining('Kein Netz.'));
      await _settle(tester);
      expect(find.textContaining('Kein Netz.'), findsNothing);
    });
  });

  group('Lebenszeichen meldet sich', () {
    late List<Buzz> buzzes;
    late List<Sound> sounds;
    // Geräteuhr: echte Zeit plus Vorstellen; eine stehende Uhr könnte Wartezeiten im Controller endlos machen.
    var shiftMs = 0;
    int clock() => DateTime.now().millisecondsSinceEpoch + shiftMs;

    setUp(() {
      buzzes = [];
      sounds = [];
      Fx.instance
        ..onBuzz = buzzes.add
        ..onPlay = sounds.add
        ..sound = true
        ..vibration = true;
      shiftMs = 0;
    });
    tearDown(() {
      Fx.instance
        ..onBuzz = null
        ..onPlay = null
        ..sound = true
        ..vibration = true;
    });

    Future<GameController> due(WidgetTester tester) async {
      final (c, s) = await _setup(tester, width: 412, clock: clock);
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester);
      expect(c.heartbeatDue, isFalse);
      expect(buzzes, isEmpty);
      // Ohne Netz bleibt die Geräteuhr maßgeblich: Ein Abgleich würde sie mit der Serverzeit gleichziehen.
      server.online = false;
      return c;
    }

    testWidgets('fällig: einmal Vibration und Ton, nicht bei jedem Neuaufbau', (tester) async {
      final c = await due(tester);
      shiftMs += (c.game!.safety.heartbeatInterval + 5) * 1000;
      await tester.runAsync(() => c.sync());
      await _settle(tester);
      expect(c.heartbeatDue, isTrue);
      expect(find.text('Ja, alles okay'), findsOneWidget);
      expect(buzzes, [Buzz.safety]);
      expect(sounds, [Sound.safety]);
      for (var i = 0; i < 3; i++) {
        await tester.runAsync(() => c.sync());
        await _settle(tester);
      }
      expect(buzzes, [Buzz.safety], reason: 'nicht wiederholt');
      expect(sounds, [Sound.safety]);
    });

    testWidgets('nach der Antwort gilt die nächste Frage wieder als neu', (tester) async {
      final c = await due(tester);
      final step = (c.game!.safety.heartbeatInterval + 5) * 1000;
      shiftMs += step;
      await tester.runAsync(() => c.sync());
      await _settle(tester);
      await tester.runAsync(() => c.heartbeat());
      await _settle(tester);
      expect(c.heartbeatDue, isFalse);
      expect(buzzes, hasLength(1));
      shiftMs += step;
      await tester.runAsync(() => c.sync());
      await _settle(tester);
      expect(buzzes, [Buzz.safety, Buzz.safety]);
      expect(sounds, [Sound.safety, Sound.safety]);
    });

    testWidgets('Schalter Geräusche aus: kein Ton; Sicherheitsvibration bleibt (wie in den Einstellungen versprochen)', (tester) async {
      final c = await due(tester);
      Fx.instance
        ..sound = false
        ..vibration = false;
      shiftMs += (c.game!.safety.heartbeatInterval + 5) * 1000;
      await tester.runAsync(() => c.sync());
      await _settle(tester);
      expect(sounds, isEmpty);
      expect(buzzes, [Buzz.safety]);
    });
  });
}
