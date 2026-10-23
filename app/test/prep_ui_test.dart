// Vorbereitung: Packen mit Fortschritt, Erlaubnisse mit Erklärung, Prüfung nach der Rückkehr aus den Einstellungen,
// Start ohne Ortung, erste Einführung, Schrift bis 200 %.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/services/location.dart';
import 'package:lykora/services/permissions.dart';
import 'package:lykora/ui/design/components.dart';
import 'package:lykora/ui/screens/briefing_screen.dart';
import 'package:lykora/ui/screens/home_screen.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';
import 'package:lykora/ui/screens/tutorial_screen.dart';

import 'support.dart';
import 'ui_support.dart';

/// Pfade aller Medien des Beispielspiels auf dem nachgebauten Server.
List<String> mediaPaths() => [
  for (final m in (gameJson['media'] as List).cast<Map>()) '/lykora/${m['src']}',
];

Future<void> tickGear(WidgetTester tester) async {
  for (final item in ['Lampe', 'Warnweste']) {
    await reveal(tester, find.text(item), 200);
    await tester.tap(find.text(item));
    await settle(tester, 2);
  }
}

Future<void> tapVisible(WidgetTester tester, Finder f) async {
  await reveal(tester, f, 200);
  await tester.tap(f);
}

void main() {
  late FakeLocation loc;
  late FakePermissions perms;

  setUpAll(() async {
    await loadAppFonts();
    GameMap.showTiles = false;
  });

  setUp(() {
    PrepScreen.skipPacking = true;
    mockAppLinks();
    (loc, perms) = fakeDevice();
  });

  tearDown(() {
    PrepScreen.skipPacking = true;
    TutorialScreen.autoInTests = false;
  });

  group('Erlaubnisse', () {
    testWidgets('erst erklärt, gefragt wird erst auf Tipp', (tester) async {
      phone(tester, height: 2400);
      final (c, s, _) = await game(tester);
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester);
      expect(find.textContaining('Damit die Spielleitung euch auf der Karte sieht'), findsOneWidget);
      expect(find.textContaining('Beim Verwenden der App'), findsOneWidget, reason: 'Hintergrund-Ortung in einem Satz erklärt');
      expect(find.textContaining('Damit Android „Lykora läuft“ anzeigt'), findsOneWidget);
      expect(find.textContaining('Nur zum Scannen der QR-Codes'), findsOneWidget);
      expect(find.textContaining('Sonst beendet Android die Ortung'), findsOneWidget);
      expect(loc.requests, 0, reason: 'kein System-Dialog, bevor das Team gelesen hat');
      expect(perms.asked, isEmpty);

      loc.afterRequest = LocationState.ready;
      await tester.tap(find.text('Erlauben').first);
      await settle(tester);
      expect(loc.requests, 1);
      expect(loc.starts, 1);
      expect(loc.lastOnError, c.onPositionError, reason: 'Fehler des Ortungsstroms landen im Controller');
      expect(find.text('Ortung an'), findsOneWidget);

      await tapVisible(tester, find.text('Erlauben').first);
      await settle(tester);
      expect(perms.asked, isNotEmpty);
    });

    testWidgets('abgelehnt für immer: Taste führt in die Einstellungen', (tester) async {
      phone(tester, height: 2400);
      final (c, s, _) = await game(tester);
      loc.state = LocationState.deniedForever;
      perms.notification = PermStatus.blocked;
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester);
      expect(find.textContaining('für Lykora gesperrt'), findsOneWidget);
      await tester.tap(find.text('Einstellungen').first);
      await settle(tester, 3);
      expect(loc.appSettings, 1);
      await tapVisible(tester, find.text('Einstellungen').at(1));
      await settle(tester, 3);
      expect(perms.settings, 1);
    });

    testWidgets('Standort aus: Taste öffnet die Standort-Einstellungen', (tester) async {
      phone(tester, height: 2400);
      final (c, s, _) = await game(tester);
      loc.state = LocationState.serviceOff;
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester);
      await tester.tap(find.text('Standort einschalten'));
      await settle(tester, 3);
      expect(loc.locationSettings, 1);
    });

    testWidgets('nach der Rückkehr aus den Einstellungen wird neu geprüft und die Ortung gestartet', (tester) async {
      phone(tester, height: 2400);
      final (c, s, _) = await game(tester);
      loc.state = LocationState.deniedForever;
      perms.notification = PermStatus.blocked;
      perms.cameraStatus = PermStatus.blocked;
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester);
      expect(find.text('Ortung an'), findsNothing);
      expect(loc.starts, 0);
      expect(c.resumed, 0);

      // Team öffnet die Systemeinstellungen, erlaubt alles und kommt zurück.
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      loc.state = LocationState.ready;
      perms.notification = PermStatus.granted;
      perms.cameraStatus = PermStatus.granted;
      perms.batteryStatus = PermStatus.granted;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await settle(tester);

      expect(c.resumed, 1, reason: 'onAppResumed des Controllers gerufen');
      expect(find.text('Ortung an'), findsOneWidget);
      expect(loc.starts, 1, reason: 'Ortung startet von selbst');
      expect(find.textContaining('ist sichtbar'), findsOneWidget);
      expect(find.text('Bereit zum Scannen.'), findsOneWidget);
      expect(find.text('Erlauben'), findsNothing);
    });

    testWidgets('toter Ortungsstrom wird nach der Rückkehr neu gestartet', (tester) async {
      phone(tester, height: 2400);
      final (c, s, _) = await game(tester);
      loc.state = LocationState.ready;
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester);
      expect(loc.starts, 1);
      c.onPositionError('Strom tot');
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await settle(tester);
      expect(loc.restarts, 1);
    });

    testWidgets('die Uhr des Spiels treibt die Anzeige der Ortung, nicht der Controller', (tester) async {
      phone(tester, height: 2400);
      var now = DateTime.now().millisecondsSinceEpoch;
      final (c, s, _) = await game(tester, clock: () => now);
      loc.state = LocationState.ready;
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester);
      await act(tester, () => c.onPosition(50.0, 7.0, 8, at: DateTime.fromMillisecondsSinceEpoch(now)));
      expect(find.text('Genauigkeit etwa 8 m'), findsOneWidget);

      now += 25000;
      c.tick();
      await tester.pump();
      expect(find.text('Kein aktuelles Signal seit 25 s. Geht ins Freie.'), findsOneWidget);

      var notified = 0;
      c.addListener(() => notified++);
      now += 5000;
      c.tick();
      await tester.pump();
      expect(notified, 0, reason: 'der Controller meldet sich nicht jede Sekunde');
      expect(find.text('Kein aktuelles Signal seit 30 s. Geht ins Freie.'), findsOneWidget);
    });
  });

  group('Start ohne Ortung', () {
    testWidgets('nur nach ausdrücklichem Ja, mit klarer Warnung und sichtbarer Markierung', (tester) async {
      phone(tester, height: 2400);
      final (c, s, _) = await game(tester);
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester);
      await tickGear(tester);

      await act(tester, () async => tester.tap(find.text('Abenteuer starten')));
      expect(find.text('Ohne Ortung starten?'), findsOneWidget);
      expect(find.text('Ohne Ortung kann die Spielleitung euch nicht sehen.'), findsOneWidget);
      expect(c.started, isFalse);

      // „Ortung einschalten“ startet nichts, sondern fragt nach der Erlaubnis.
      await tester.tap(find.text('Ortung einschalten'));
      await settle(tester);
      expect(loc.requests, 1);
      expect(c.started, isFalse);

      await act(tester, () async => tester.tap(find.text('Abenteuer starten')));
      await act(tester, () async => tester.tap(find.text('Trotzdem ohne Ortung starten')));
      expect(c.started, isTrue);
      expect(c.locationError, isNotNull, reason: 'im Spiel bleibt sichtbar, dass keine Ortung läuft');
    });

    testWidgets('mit Ortung gibt es keine Rückfrage', (tester) async {
      phone(tester, height: 2400);
      final (c, s, _) = await game(tester);
      loc.state = LocationState.ready;
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester);
      await tickGear(tester);
      await act(tester, () async => tester.tap(find.text('Abenteuer starten')));
      expect(find.text('Ohne Ortung starten?'), findsNothing);
      expect(c.started, isTrue);
      expect(c.locationError, isNull);
    });
  });

  group('Medien', () {
    testWidgets('fehlende Klänge: sagt was fehlt, bietet Nachladen an und sperrt den Start nicht', (tester) async {
      phone(tester, height: 2400);
      final server = FakeServer()..missingMedia.add('/lykora/media/lib/donner.ogg');
      final (c, s, _) = await game(tester, server: server);
      loc.state = LocationState.ready;
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester);
      await reveal(tester, find.text('Nicht alles geladen'), -200);
      expect(find.textContaining('8 von 9 Dateien'), findsOneWidget);
      expect(find.textContaining('Es fehlen 1 Klang.'), findsOneWidget);
      expect(find.textContaining('Ihr könnt trotzdem starten'), findsOneWidget);

      await tickGear(tester);
      expect(tester.widget<LKey>(find.widgetWithText(LKey, 'Abenteuer starten')).onPressed, isNotNull, reason: 'fehlende Medien sperren nie');

      server.missingMedia.clear();
      await reveal(tester, find.text('Nochmal laden'), -200);
      await act(tester, () async => tester.tap(find.text('Nochmal laden')), real: 600);
      expect(c.missingMedia, 0);
      await reveal(tester, find.textContaining('Alles da: 9 Dateien'), -200);
      expect(find.text('Nicht alles geladen'), findsNothing);
    });

    testWidgets('Packen zeigt den Fortschritt und warnt vor dem Datenvolumen', (tester) async {
      phone(tester, height: 2400);
      PrepScreen.skipPacking = false;
      final server = FakeServer();
      for (final p in mediaPaths()) {
        server.delayFor[p] = const Duration(milliseconds: 150);
      }
      final (c, s, _) = await game(tester, server: server, awaitMedia: false);
      expect(c.mediaProgress.value.running, isTrue);
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Packen'), findsOneWidget);
      expect(find.textContaining('von 9 Dateien'), findsOneWidget);
      expect(find.textContaining('Das verbraucht Datenvolumen'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);

      await tester.runAsync(c.waitForMedia);
      expect(c.mediaProgress.value.complete, isTrue);
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 650));
      }
      await settle(tester, 3);
      expect(find.text('STARTKLAR?'), findsOneWidget);
    });

    testWidgets('Packen mit fehlendem Klang: Nochmal laden, danach weiter', (tester) async {
      phone(tester, height: 2400);
      PrepScreen.skipPacking = false;
      final server = FakeServer()..missingMedia.add('/lykora/media/lib/donner.ogg');
      final (c, s, _) = await game(tester, server: server);
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester, 4);
      expect(find.textContaining('Es fehlen 1 Klang'), findsOneWidget);
      server.missingMedia.clear();
      await act(tester, () async => tester.tap(find.text('Nochmal laden')), real: 600);
      expect(c.missingMedia, 0);
    });

    testWidgets('Tippen überspringt das Packen', (tester) async {
      phone(tester, height: 2400);
      PrepScreen.skipPacking = false;
      final (c, s, _) = await game(tester);
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester, 4);
      expect(find.text('Packen'), findsOneWidget);
      await tester.tap(find.text('Weiter'));
      await settle(tester, 3);
      expect(find.text('STARTKLAR?'), findsOneWidget);
    });

    test('formatBytes und missingMediaText', () {
      expect(formatBytes(900), '900 B');
      expect(formatBytes(2048), '2 KB');
      expect(formatBytes(3 * 1024 * 1024 + 512 * 1024), '3,5 MB');
      expect(formatBytes(18 * 1024 * 1024), '18 MB');
    });
  });

  group('Einführung', () {
    testWidgets('beim ersten Start nach dem Briefing, überspringbar, nur einmal', (tester) async {
      phone(tester, height: 2400);
      TutorialScreen.autoInTests = true;
      final (c, s, _) = await game(tester);
      await tester.runAsync(() => c.start());
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await settle(tester);
      expect(find.byType(BriefingScreen), findsOneWidget);

      await act(tester, () async => tester.tap(find.text('Verstanden, Zentrale!')));
      expect(find.byType(TutorialScreen), findsOneWidget);
      expect(textCI('Der Peiler'), findsOneWidget);
      await tester.tap(find.text('Weiter'));
      await settle(tester);
      expect(textCI('Der Funk'), findsOneWidget);
      await tester.tap(find.text('Weiter'));
      await settle(tester);
      expect(find.text('Los geht’s'), findsOneWidget);
      expect(find.text('Überspringen'), findsNothing);
      await act(tester, () async => tester.tap(find.text('Los geht’s')));
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(File('${c.store.dir.path}/tutorial-seen').existsSync(), isTrue);

      // Zweiter Anlauf auf demselben Handy: keine Einführung mehr.
      await tester.runAsync(() => c.leave());
      final (c2, s2, _) = await game(tester);
      await tester.runAsync(() async {
        File('${c2.store.dir.path}/tutorial-seen').writeAsStringSync('1');
        await c2.start();
      });
      await tester.pumpWidget(LykoraApp(controller: c2, settings: s2));
      await settle(tester);
      await act(tester, () async => tester.tap(find.text('Verstanden, Zentrale!')));
      expect(find.byType(TutorialScreen), findsNothing);
      expect(find.byType(HomeScreen), findsOneWidget);
    });

    testWidgets('Überspringen schließt und merkt sich das', (tester) async {
      phone(tester, height: 2400);
      TutorialScreen.autoInTests = true;
      final (c, s, _) = await game(tester);
      await tester.runAsync(() => c.start());
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await settle(tester);
      await act(tester, () async => tester.tap(find.text('Verstanden, Zentrale!')));
      await act(tester, () async => tester.tap(find.text('Überspringen')));
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(await tester.runAsync(() => tutorialSeen(c.store)), isTrue);
    });

    testWidgets('lässt sich jederzeit wieder öffnen (Vorbereitung, später Einstellungen)', (tester) async {
      phone(tester, height: 2400);
      final (c, s, _) = await game(tester);
      await tester.pumpWidget(scaled(1, const PrepScreen(), c: c, s: s));
      await settle(tester);
      await tapVisible(tester, find.text('Kurz erklärt'));
      await settle(tester);
      expect(textCI('Der Peiler'), findsOneWidget);
      expect(find.textContaining('weit, unterwegs, nah, hier'), findsOneWidget);
    });
  });

  group('Schrift und Breite', () {
    for (final width in [320.0, 360.0, 412.0]) {
      for (final scale in [1.0, 1.6, 2.0]) {
        testWidgets('Startklar bei ${width.round()} dp und ${(scale * 100).round()} % läuft nicht über', (tester) async {
          phone(tester, width: width, height: 640);
          final server = FakeServer()..missingMedia.add('/lykora/media/lib/donner.ogg');
          final (c, s, _) = await game(tester, server: server);
          // alles fehlt: längste Texte und alle Tasten
          await tester.pumpWidget(scaled(scale, const PrepScreen(), c: c, s: s));
          await settle(tester);
          expect(tester.takeException(), isNull);
          // bis ans Ende der Liste blättern, jede Zeile einmal sichtbar machen
          await reveal(tester, find.text('Kurz erklärt'), 300);
          await settle(tester, 3);
          expect(tester.takeException(), isNull);
          loc.state = LocationState.ready;
          tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
          tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
          await settle(tester, 3);
          expect(tester.takeException(), isNull);
        });

        testWidgets('Packen bei ${width.round()} dp und ${(scale * 100).round()} % läuft nicht über', (tester) async {
          phone(tester, width: width, height: 640);
          PrepScreen.skipPacking = false;
          final server = FakeServer()..missingMedia.add('/lykora/media/lib/donner.ogg');
          final (c, s, _) = await game(tester, server: server);
          await tester.pumpWidget(scaled(scale, const PrepScreen(), c: c, s: s));
          for (var i = 0; i < 4; i++) {
            await tester.pump(const Duration(milliseconds: 700));
            expect(tester.takeException(), isNull);
          }
        });
      }
    }

    testWidgets('Ausrüstung abhaken und Sheet „Ohne Ortung“ bei 200 % auf 320 dp', (tester) async {
      phone(tester, width: 320, height: 640);
      final (c, s, _) = await game(tester);
      await tester.pumpWidget(scaled(2, const PrepScreen(), c: c, s: s));
      await settle(tester);
      await tickGear(tester);
      await act(tester, () async => tester.tap(find.text('Abenteuer starten')));
      expect(find.text('Ohne Ortung starten?'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
