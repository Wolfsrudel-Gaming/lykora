// Rendert die wichtigsten Bildschirme mit den echten Schriften und bedient sie wie ein Team.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/ui/design/components.dart';
import 'package:lykora/ui/design/tokens.dart';
import 'package:lykora/ui/safety/sos_screen.dart';
import 'package:lykora/ui/screens/briefing_screen.dart';
import 'package:lykora/ui/screens/home_screen.dart';
import 'package:lykora/ui/screens/join_screen.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';
import 'package:lykora/ui/screens/reward_screen.dart';
import 'package:lykora/ui/screens/station_screen.dart';

import 'support.dart';

late FakeServer server;

Future<(GameController, AppSettings)> _setup(WidgetTester tester, {bool join = true}) async {
  // Handy hochkant statt der Standardfläche 800×600
  tester.view.physicalSize = const Size(1236, 2745);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  server = FakeServer();
  late GameController c;
  late AppSettings settings;
  await tester.runAsync(() async {
    final dir = await Directory.systemTemp.createTemp('lykora-ui-');
    final store = SessionStore(dir);
    c = GameController(
      store: store,
      apiFactory: (s, t) => Api(s, token: t, client: server.client()),
      backgroundLoops: false,
    );
    if (join) await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
    settings = AppSettings(store);
  });
  return (c, settings);
}

/// Seite allein, aber mit Theme der Spielwelt.
Widget _wrap(GameController c, AppSettings s, Widget child) => Lykora(
  controller: c,
  settings: s,
  child: MaterialApp(theme: buildTheme(s.tokensFor(c.game)), home: child),
);

/// Feste Zahl von Frames statt pumpAndSettle: Laterne und Peiler atmen ständig.
/// Wechselt zwischen echter Ereignisschleife (Dateizugriffe) und simulierter Zeit (Animationen).
Future<void> settle(WidgetTester tester, [int frames = 10]) async {
  for (var i = 0; i < frames; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 15)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> act(WidgetTester tester, Future<void> Function() f) async {
  await tester.runAsync(() async {
    await f();
    // Dateizugriffe brauchen die echte Ereignisschleife.
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
  await settle(tester);
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

  testWidgets('ohne Sitzung startet die App beim Einstieg', (tester) async {
    final (c, s) = await _setup(tester, join: false);
    await tester.pumpWidget(LykoraApp(controller: c, settings: s));
    await settle(tester);
    expect(find.byType(JoinScreen), findsOneWidget);
    expect(find.text('Event-Karte scannen'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'k7m2qx');
    await settle(tester);
    expect(find.text('K'), findsOneWidget, reason: 'Code in Großbuchstaben in den Kästchen');
    await tester.tap(find.text('Weiter'));
    await settle(tester);
    expect(find.byType(TeamSetupScreen), findsOneWidget);
    expect(find.text('Wie heißt euer Team?'), findsOneWidget);
    await tester.tap(find.text('Die Füchse'));
    await settle(tester);
    await tester.tap(find.text('Weiter'));
    await settle(tester);
    expect(find.text('Wer ist dabei?'), findsOneWidget);
  });

  testWidgets('Vorbereitung: Startklar, Ausrüstung, Lichtwahl', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.pumpWidget(LykoraApp(controller: c, settings: s));
    await settle(tester);
    expect(find.byType(PrepScreen), findsOneWidget);
    expect(find.text('STARTKLAR?'), findsOneWidget);
    expect(find.text('Erst Ausrüstung abhaken'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Warnweste'), 200);
    await tester.tap(find.text('Lampe'));
    await tester.tap(find.text('Warnweste'));
    await settle(tester);
    expect(find.text('Abenteuer starten'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Rotlicht'), 200);
    await tester.tap(find.text('Rotlicht').last);
    await settle(tester);
    expect(s.lightMode, LightMode.red);
    expect(find.text('SOS'), findsOneWidget, reason: 'Sicherheitsleiste liegt über jeder Seite');
  });

  testWidgets('Briefing, dann Spielrahmen mit Weg, Funk und Akte', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() => c.start());
    await tester.pumpWidget(LykoraApp(controller: c, settings: s));
    await settle(tester);
    expect(find.byType(BriefingScreen), findsOneWidget);
    expect(find.textContaining('Funkstation am Ahrenbach'), findsOneWidget);
    await act(tester, () async => tester.tap(find.text('Verstanden, Zentrale!')));
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.text('Einsatzprotokoll'), findsOneWidget, reason: 'Akte trägt den Namen der Spielwelt');
    expect(find.text('Peilempfänger'.toUpperCase()), findsOneWidget);
    await tester.tap(find.text('Liste'));
    await settle(tester);
    expect(find.text('SICHERHEITS-BRIEFING'), findsOneWidget);
    expect(find.text('DAS VERSTECK'), findsNothing);
    await tester.tap(find.text('Funk'));
    await settle(tester);
    expect(find.text('Uns ist mulmig'), findsOneWidget);
    await tester.tap(find.text('Einsatzprotokoll'));
    await settle(tester);
    expect(find.text('Schlüsselbund'.toUpperCase()), findsOneWidget);
  });

  testWidgets('Station als Szene: Funkspruch, Erzähler, Rätsel, Belohnung', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() async {
      await c.start();
      await c.trigger('baum', 'gps');
    });
    await tester.pumpWidget(_wrap(c, s, const StationScreen(stationId: 'baum')));
    await settle(tester);
    expect(find.textContaining('Hier wurde das Funkgerät zuletzt gesehen.'), findsOneWidget);
    await tester.tap(find.text('Weiter'));
    await settle(tester);
    expect(find.textContaining('Die Rinde ist nass'), findsOneWidget);
    await tester.tap(find.text('Zum Rätsel'));
    await settle(tester);
    expect(c.session!.seenScenes, contains('baum'));
    await tester.enterText(find.byType(TextField), 'Fuchs');
    await act(tester, () async => tester.tap(find.text('Prüfen')));
    expect(c.state.wrongAnswers, 1);
    expect(find.textContaining('Das passt nicht'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Eule');
    await act(tester, () async => tester.tap(find.text('Prüfen')));
    expect(c.state.solved.keys, contains('baum'));
    expect(find.byType(RewardScreen), findsOneWidget);
    expect(find.text('AUFTRAG ERFÜLLT'), findsOneWidget);
    await settle(tester, 30);
    expect(find.text('Weiter peilen'), findsOneWidget);
    expect(find.text('1'), findsWidgets, reason: 'Fragment mit Position und Ziffer');
  });

  testWidgets('Auswahl, Tipp als Funkspruch', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() async {
      await c.start();
      await c.trigger('baum', 'qr');
      await c.markSceneSeen('baum');
      await c.trigger('briefing', 'qr');
      await c.markSceneSeen('briefing');
    });
    await tester.pumpWidget(_wrap(c, s, const StationScreen(stationId: 'baum')));
    await settle(tester);
    await tester.tap(find.text('Tipp funken'));
    await settle(tester);
    await act(tester, () async => tester.tap(find.text('Tipp anfordern')));
    expect(c.state.hints['baum'], 1);
    expect(find.textContaining('Schaut auf Augenhöhe.'), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(_wrap(c, s, const StationScreen(stationId: 'briefing')));
    await settle(tester);
    await tester.tap(find.text('SOS drücken und bei der Person bleiben'));
    await settle(tester);
    await act(tester, () async => tester.tap(find.text('Prüfen')));
    expect(c.state.solved.keys, contains('briefing'));
  });

  testWidgets('Zahlenschloss mit Rädern', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() async {
      await c.start();
      await c.trigger('schloss', 'qr');
      await c.markSceneSeen('schloss');
    });
    await tester.pumpWidget(_wrap(c, s, const StationScreen(stationId: 'schloss')));
    await settle(tester);
    Future<void> turn(String label, int n) async {
      for (var i = 0; i < n; i++) {
        await tester.tap(find.bySemanticsLabel(label));
        await tester.pump(const Duration(milliseconds: 50));
      }
    }

    await turn('Rad 1 hoch', 3);
    await turn('Rad 2 runter', 3);
    await turn('Rad 3 hoch', 2);
    await settle(tester);
    await act(tester, () async => tester.tap(find.text('Schloss öffnen')));
    expect(c.state.solved.keys, contains('schloss'));
  });

  testWidgets('Finale: Teile einsetzen statt abtippen', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() async {
      await c.start();
      for (final (id, answer) in [
        ('baum', {'text': 'Eule'}),
        ('schloss', {'text': '372'}),
        ('versteck', {'upload': 'foto'}),
      ]) {
        await c.trigger(id, 'qr');
        await c.answer(id, answer);
      }
      await c.trigger('finale', 'qr');
      await c.markSceneSeen('finale');
    });
    expect(c.fragmentsComplete(), isTrue);
    await tester.pumpWidget(_wrap(c, s, const StationScreen(stationId: 'finale')));
    await settle(tester);
    expect(find.text('Erst alle Teile einsetzen'), findsOneWidget);
    for (final token in find.byType(FragmentToken).evaluate().toList()) {
      await tester.tap(find.byWidget(token.widget));
      await tester.pump(const Duration(milliseconds: 100));
    }
    await settle(tester);
    await act(tester, () async => tester.tap(find.text('Öffnen')));
    expect(c.finished, isTrue);
  });

  testWidgets('SOS braucht drei Sekunden Halten', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.pumpWidget(_wrap(c, s, const SosScreen()));
    await settle(tester);
    expect(find.text('SOS – 3 Sekunden halten'), findsOneWidget);
    expect(find.text('112 anrufen'), findsOneWidget);
    // Kurzes Tippen löst nichts aus.
    await tester.tap(find.bySemanticsLabel(RegExp('SOS. Drei Sekunden')));
    await settle(tester);
    expect(find.text('SOS – 3 Sekunden halten'), findsOneWidget);
    expect(server.sos, isEmpty);
    // Halten schon.
    final gesture = await tester.startGesture(tester.getCenter(find.bySemanticsLabel(RegExp('SOS. Drei Sekunden'))));
    await tester.pump(const Duration(milliseconds: 200));
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(seconds: 1));
    }
    await act(tester, () async => gesture.up());
    expect(server.sos, hasLength(1));
  });

  testWidgets('Rückruf liegt als echte Durchsage über dem Spiel', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() async {
      await c.start();
      await c.markIntroSeen();
    });
    await tester.pumpWidget(LykoraApp(controller: c, settings: s));
    await settle(tester);
    server.status = 'recalled';
    await act(tester, () => c.sync());
    expect(find.text('ALLE ZURÜCK ZUM SAMMELPUNKT'), findsOneWidget);
    expect(find.text('ECHT – KEIN SPIEL'), findsOneWidget);
    await act(tester, () async => tester.tap(find.text('Wir sind unterwegs')));
    expect(c.session!.recallAcknowledged, isTrue);
    expect(server.messages.single['body'], contains('unterwegs'));
    expect(find.text('ALLE ZURÜCK ZUM SAMMELPUNKT'), findsNothing);
    expect(find.textContaining('Alle zurück zum Sammelpunkt'), findsOneWidget, reason: 'bleibt als Streifen sichtbar');
  });

  testWidgets('Sperrzone: Warnung vorher, Vollbild drin', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() async {
      await c.start();
      await c.markIntroSeen();
    });
    await tester.pumpWidget(LykoraApp(controller: c, settings: s));
    await settle(tester);
    await act(tester, () => c.onPosition(50.81662, 7.1552, 5));
    expect(find.textContaining('Achtung: Straße in'), findsOneWidget);
    await act(tester, () => c.onPosition(50.8169, 7.1552, 5));
    expect(find.textContaining('Ihr seid in der Sperrzone'), findsOneWidget);
    await act(tester, () => c.onPosition(50.8155, 7.155, 5));
    expect(find.text('Danke, ihr seid wieder sicher.'), findsOneWidget);
  });
}
