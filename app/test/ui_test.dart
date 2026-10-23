// Rendert die wichtigsten Bildschirme mit den echten Schriften und bedient sie wie ein Team.

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/services/fx.dart';
import 'package:lykora/services/soundscape.dart';
import 'package:lykora/ui/design/components.dart';
import 'package:lykora/ui/design/tokens.dart';
import 'package:lykora/ui/safety/sos_screen.dart';
import 'package:lykora/ui/screens/briefing_screen.dart';
import 'package:lykora/ui/screens/home_screen.dart';
import 'package:lykora/ui/screens/join_screen.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';
import 'package:lykora/ui/screens/reward_screen.dart';
import 'package:lykora/ui/screens/settings_screen.dart';
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

/// Abgleich nach einem SOS aus der Seite: Der Alarm hängt an Futures der simulierten Zeit, die nur beim Pumpen weiterlaufen;
/// ein Abgleich allein in runAsync würde auf sie warten.
Future<void> syncInGame(WidgetTester tester, GameController c) async {
  final sync = c.sync();
  await settle(tester, 30);
  await tester.runAsync(() => sync.timeout(const Duration(seconds: 10)));
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

  testWidgets('SOS zeigt, ob die Spielleitung gelesen hat', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.pumpWidget(_wrap(c, s, const SosScreen()));
    await settle(tester);
    final gesture = await tester.startGesture(tester.getCenter(find.bySemanticsLabel(RegExp('SOS. Drei Sekunden'))));
    await tester.pump(const Duration(milliseconds: 200));
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(seconds: 1));
    }
    await act(tester, () async => gesture.up());
    // Der Alarm wird vor dem Senden gespeichert: Dateizugriff und Senden brauchen mehrere Runden der echten Ereignisschleife.
    await settle(tester, 40);
    final id = server.sos.single['id'] as String;
    expect(find.text('Internet: Alarm ist bei der Spielleitung angekommen.'), findsOneWidget);
    expect(find.textContaining('Warten, bis die Spielleitung'), findsOneWidget);

    server.sosAck[id] = {'acknowledgedAt': DateTime.now().toUtc().toIso8601String(), 'acknowledgedBy': 'Anna'};
    await syncInGame(tester, c);
    expect(find.text('Spielleitung hat gelesen (Anna).'), findsOneWidget);
    expect(find.textContaining('Warten, bis'), findsNothing);
    expect(find.textContaining('Bleibt, wo ihr seid'), findsOneWidget);

    server.sosAck[id] = {...server.sosAck[id]!, 'resolvedAt': DateTime.now().toUtc().toIso8601String()};
    await syncInGame(tester, c);
    expect(find.textContaining('erledigt'), findsOneWidget);
    expect(find.textContaining('Bleibt, wo ihr seid'), findsNothing);
  });

  testWidgets('SOS abgelehnt: bleibt „nicht gesendet“, auch nach dem nächsten Abgleich', (tester) async {
    final (c, s) = await _setup(tester);
    server.rejectSos = true;
    await tester.pumpWidget(_wrap(c, s, const SosScreen()));
    await settle(tester);
    final gesture = await tester.startGesture(tester.getCenter(find.bySemanticsLabel(RegExp('SOS. Drei Sekunden'))));
    await tester.pump(const Duration(milliseconds: 200));
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(seconds: 1));
    }
    await act(tester, () async => gesture.up());
    // Der Alarm wird vor dem Senden gespeichert: Dateizugriff und Senden brauchen mehrere Runden der echten Ereignisschleife.
    await settle(tester, 40);
    expect(find.textContaining('nicht gesendet'), findsOneWidget);
    expect(find.textContaining('nicht angenommen'), findsOneWidget);
    expect(find.textContaining('nachgeholt'), findsNothing, reason: 'abgelehnt wird nicht nachgeholt');
    expect(find.textContaining('angekommen'), findsNothing);
    await syncInGame(tester, c);
    expect(find.textContaining('angekommen'), findsNothing, reason: 'ein abgelehnter Alarm wartet nicht und kommt nie an');
    expect(find.textContaining('Bleibt, wo ihr seid'), findsNothing);
    expect(find.text('SMS jetzt senden'), findsOneWidget);
  });

  testWidgets('SOS ohne Netz: nach dem Nachreichen „angekommen“', (tester) async {
    final (c, s) = await _setup(tester);
    server.online = false;
    await tester.pumpWidget(_wrap(c, s, const SosScreen()));
    await settle(tester);
    final gesture = await tester.startGesture(tester.getCenter(find.bySemanticsLabel(RegExp('SOS. Drei Sekunden'))));
    await tester.pump(const Duration(milliseconds: 200));
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(seconds: 1));
    }
    await act(tester, () async => gesture.up());
    // Der Alarm wird vor dem Senden gespeichert: Dateizugriff und Senden brauchen mehrere Runden der echten Ereignisschleife.
    await settle(tester, 40);
    expect(find.textContaining('nicht gesendet'), findsOneWidget);
    expect(find.textContaining('wird nachgeholt'), findsOneWidget, reason: 'gespeichert, also ehrlich „wird nachgeholt“');
    expect(c.sosPending, isTrue);
    server.online = true;
    // Der Abgleich läuft in der simulierten Zeit weiter, in der auch das Speichern des Alarms begann;
    // die echte Ereignisschleife bekommt in settle() ihre Runden für die Dateizugriffe.
    await syncInGame(tester, c);
    expect(server.sos.single['deferred'], isTrue);
    expect(find.text('Internet: Alarm ist bei der Spielleitung angekommen.'), findsOneWidget);
    expect(find.textContaining('Warten, bis die Spielleitung'), findsOneWidget);
  });

  testWidgets('Cue: Klang allein bleibt aus dem Funk, mit Text kommt er als Funkspruch', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() async {
      await c.start();
      await c.markIntroSeen();
    });
    await tester.pumpWidget(LykoraApp(controller: c, settings: s));
    await settle(tester);
    server.pendingMessages
      ..add({
        'kind': 'cue',
        'body': jsonEncode({'audio': 'eule', 'src': 'media/lib/eule.ogg', 'volume': 0.8}),
      })
      ..add({
        'kind': 'cue',
        'body': jsonEncode({'audio': 'lib:wolf-heulen', 'src': 'media/lib/wolf-heulen.ogg', 'volume': 0.8, 'text': 'Was war das?'}),
      });
    await act(tester, () => c.sync());
    expect(find.text('Was war das?'), findsOneWidget, reason: 'Funk-Hinweis wie bei anderen Funksprüchen');
    expect(find.bySemanticsLabel('Funk, 1 neu'), findsOneWidget);
    await tester.tap(find.widgetWithText(SnackBarAction, 'Funk'));
    await settle(tester);
    expect(find.bySemanticsLabel('Funk, 1 neu'), findsNothing);
    expect(find.text('Was war das?'), findsWidgets);
    expect(find.textContaining('"audio"'), findsNothing);
    expect(find.textContaining('eule'), findsNothing);
  });

  testWidgets('Packen zählt die Klänge, die wirklich auf dem Handy liegen', (tester) async {
    PrepScreen.skipPacking = false;
    addTearDown(() => PrepScreen.skipPacking = true);
    final (c, s) = await _setup(tester, join: false);
    server.missingMedia.add('/lykora/media/lib/donner.ogg');
    await tester.runAsync(() => c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse'));
    await tester.pumpWidget(LykoraApp(controller: c, settings: s));
    await tester.pump();
    expect(find.text('Klänge und Bilder'), findsOneWidget);
    expect(find.text('8 von 9 Klängen'), findsOneWidget);
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 500));
    }
    await settle(tester);
    expect(find.text('STARTKLAR?'), findsOneWidget);
  });

  testWidgets('Einstellungen: Lautstärke der Atmosphäre und Schalter Geräusche', (tester) async {
    final (c, s) = await _setup(tester);
    addTearDown(() => Fx.instance.sound = true);
    await tester.pumpWidget(_wrap(c, s, const SettingsScreen()));
    await settle(tester);
    expect(find.text('Atmosphäre 80 %'), findsOneWidget);
    tester.widget<Slider>(find.byType(Slider).first).onChanged!(0.3);
    await settle(tester);
    expect(s.ambience, 0.3);
    expect(Soundscape.instance.volume, 0.3);
    expect(find.text('Atmosphäre 30 %'), findsOneWidget);
    await tester.tap(find.text('Geräusche'));
    await settle(tester);
    expect(s.sound, isFalse);
    expect(find.text('Atmosphäre aus'), findsOneWidget);
    expect(tester.widget<Slider>(find.byType(Slider).first).onChanged, isNull);
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
    expect(find.textContaining('Ihr seid in der Sperrzone'), findsNothing, reason: 'ein Fix reicht nicht für das Vollbild');
    await act(tester, () => c.onPosition(50.8169, 7.1552, 5));
    expect(find.textContaining('Ihr seid in der Sperrzone'), findsOneWidget);
    await act(tester, () => c.onPosition(50.8155, 7.155, 5));
    expect(find.text('Danke, ihr seid wieder sicher.'), findsOneWidget);
  });
}
