// Einstieg: Fehlertexte nach Fehlerart, Fortsetzen nach abgebrochenem Beitritt, Adressprüfung, Scanner-Fehlerseite,
// Haptik beim Auslösen per Code, Schrift bis 200 %.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/services/fx.dart';
import 'package:lykora/ui/design/components.dart';
import 'package:lykora/ui/screens/join_screen.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';
import 'package:lykora/ui/widgets/triggers.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'support.dart';
import 'ui_support.dart';

/// Tippt sich durch die drei Schritte „Team anlegen“ bis zum Beitreten.
Future<void> fillTeam(WidgetTester tester) async {
  await tester.tap(find.text('Die Füchse'));
  await settle(tester, 3);
  await tester.tap(find.text('Weiter'));
  await settle(tester, 3);
  await tester.tap(find.text('Weiter'));
  await settle(tester, 3);
}

Future<void> submit(WidgetTester tester, [String label = 'Verstanden – los geht’s']) async {
  await act(tester, () async => tester.tap(find.text(label)));
}

void main() {
  setUpAll(() async {
    await loadAppFonts();
    GameMap.showTiles = false;
    PrepScreen.skipPacking = true;
  });

  setUp(mockAppLinks);

  group('Fehlertexte beim Beitritt', () {
    // Fehlerart des Servers -> Satz, der in der Oberfläche stehen muss
    final cases = <String, ({void Function(FakeServer) setup, String text, bool retry})>{
      'offline': (setup: (s) => s.online = false, text: 'Der Server ist nicht erreichbar', retry: true),
      'server': (setup: (s) => s.fail('/join', 503), text: 'Der Server hat gerade ein Problem (Fehler 503)', retry: true),
      'unauthorized': (setup: (s) => s.fail('/join', 401), text: 'Die Anmeldung dieses Handys gilt nicht mehr', retry: false),
      'rateLimited': (setup: (s) => s.fail('/join', 429), text: 'Zu viele Versuche', retry: true),
      'notLykora': (setup: (s) => s.captivePortal = true, text: 'Hier antwortet kein Lykora-Server', retry: true),
      'notFound': (setup: (s) => s.fail('/join', 404), text: 'Diesen Event-Code kennt der Server nicht', retry: false),
      'rejected': (setup: (s) => s.fail('/join', 400), text: 'Server kaputt', retry: false),
    };
    for (final e in cases.entries) {
      testWidgets('${e.key}: eigener Satz und passende Taste', (tester) async {
        phone(tester);
        final (c, s, server) = await game(tester, join: false);
        e.value.setup(server);
        await tester.pumpWidget(scaled(1, const TeamSetupScreen(server: address, code: 'K7M2QX'), c: c, s: s));
        await settle(tester);
        await fillTeam(tester);
        await submit(tester);
        expect(find.textContaining(e.value.text), findsOneWidget);
        expect(find.text('Nochmal versuchen'), e.value.retry ? findsOneWidget : findsNothing);
        expect(tester.takeException(), isNull);
        expect(c.hasSession, isFalse, reason: 'nichts angelegt, wenn schon /join scheitert');
      });
    }

    testWidgets('timeout: zu langsam, nochmal versuchen', (tester) async {
      phone(tester);
      final server = FakeServer()..delayFor['/join'] = const Duration(milliseconds: 600);
      final (c, s, _) = await game(tester, join: false, server: server, timeout: const Duration(milliseconds: 100));
      await tester.pumpWidget(scaled(1, const TeamSetupScreen(server: address, code: 'K7M2QX'), c: c, s: s));
      await settle(tester);
      await fillTeam(tester);
      await submit(tester);
      expect(find.textContaining('Der Server antwortet zu langsam'), findsOneWidget);
      expect(find.text('Nochmal versuchen'), findsOneWidget);
    });

    testWidgets('badAddress: Adresse prüfen, ohne dass ein Team entsteht', (tester) async {
      phone(tester);
      final (c, s, server) = await game(tester, join: false);
      await tester.pumpWidget(scaled(1, const TeamSetupScreen(server: 'kaputt', code: 'K7M2QX'), c: c, s: s));
      await settle(tester);
      await fillTeam(tester);
      await submit(tester);
      expect(find.textContaining('Die Server-Adresse stimmt nicht'), findsOneWidget);
      expect(find.text('Adresse prüfen'), findsOneWidget);
      expect(find.text('Nochmal versuchen'), findsNothing, reason: 'dieselbe Adresse wird nie besser');
      expect(server.joinCalls, 0);
    });

    testWidgets('Anmeldeseite im WLAN: sagt, dass erst angemeldet werden muss', (tester) async {
      phone(tester);
      final (c, s, server) = await game(tester, join: false);
      server.captivePortal = true;
      await tester.pumpWidget(scaled(1, const TeamSetupScreen(server: address, code: 'K7M2QX'), c: c, s: s));
      await settle(tester);
      await fillTeam(tester);
      await submit(tester);
      expect(find.textContaining('erst im WLAN anmelden'), findsOneWidget);
      expect(find.text('Adresse prüfen'), findsOneWidget);
    });

    testWidgets('Gerätecode unbekannt: Satz nennt den Gerätecode, Taste „Code ändern“', (tester) async {
      phone(tester);
      final (c, s, server) = await game(tester, join: false);
      server.fail('/join', 404);
      await tester.pumpWidget(scaled(1, const TeamSetupScreen(server: address, code: 'K7M2QX'), c: c, s: s));
      await settle(tester);
      await tester.tap(find.text('Weiteres Handy für ein Team'));
      await settle(tester, 3);
      await tester.enterText(find.byType(TextField).first, 'zz99');
      await settle(tester, 3);
      await submit(tester, 'Beitreten');
      expect(find.textContaining('Diesen Gerätecode kennt der Server nicht'), findsOneWidget);
      expect(find.text('Code ändern'), findsOneWidget);
    });
  });

  group('Fortsetzen', () {
    testWidgets('zweiter Versuch nach gescheitertem Spielpaket legt kein zweites Team an', (tester) async {
      phone(tester);
      final server = FakeServer()
        ..uniqueTeamNames = true
        ..fail('/play/game', 503, times: 1);
      final (c, s, _) = await game(tester, join: false, server: server);
      await tester.pumpWidget(scaled(1, const TeamSetupScreen(server: address, code: 'K7M2QX'), c: c, s: s));
      await settle(tester);
      await fillTeam(tester);
      await submit(tester);
      expect(find.textContaining('Der Server hat gerade ein Problem'), findsOneWidget);
      expect(c.needsPackage, isTrue, reason: 'Sitzung steht schon');
      expect(find.text('Nochmal versuchen'), findsOneWidget);

      await submit(tester, 'Nochmal versuchen');
      expect(server.joinCalls, 1, reason: 'der Server kennt das Team schon');
      expect(c.hasGame, isTrue);
      expect(c.needsPackage, isFalse);
    });

    testWidgets('nach Neustart führt der Einstieg direkt zum Laden des Spielpakets', (tester) async {
      phone(tester);
      final server = FakeServer()
        ..uniqueTeamNames = true
        ..fail('/play/game', 503);
      late Directory dir;
      await tester.runAsync(() async {
        dir = await Directory.systemTemp.createTemp('lykora-resume-');
        final first = controllerFor(server, dir);
        try {
          await first.join(server: address, code: 'K7M2QX', teamName: 'Füchse');
        } on ApiException {
          // erwartet
        }
      });
      server.heal();
      final c = controllerFor(server, dir);
      late AppSettings s;
      await tester.runAsync(() async {
        await c.load();
        s = AppSettings(SessionStore(dir));
      });
      expect(c.needsPackage, isTrue);

      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await tester.pump();
      expect(find.text('Event-Karte scannen'), findsNothing, reason: 'nicht zurück zum Einstieg');
      expect(find.textContaining('Euer Team „Füchse“ steht schon'), findsOneWidget);
      expect(find.text('AB3D'), findsOneWidget, reason: 'Gerätecode steht groß da');
      await act(tester, () async {});
      expect(c.hasGame, isTrue, reason: 'lädt von selbst');
      expect(server.joinCalls, 1);
      expect(find.byType(PrepScreen), findsOneWidget);
    });

    testWidgets('Paketfehler beim Laden: Satz, „Nochmal versuchen“ und Ausweg „anderes Team“', (tester) async {
      phone(tester);
      final server = FakeServer()..fail('/play/game', 502);
      late Directory dir;
      await tester.runAsync(() async {
        dir = await Directory.systemTemp.createTemp('lykora-resume2-');
        try {
          await controllerFor(server, dir).join(server: address, code: 'K7M2QX', teamName: 'Füchse');
        } on ApiException {
          // erwartet
        }
      });
      final c = controllerFor(server, dir);
      late AppSettings s;
      await tester.runAsync(() async {
        await c.load();
        s = AppSettings(SessionStore(dir));
      });
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await act(tester, () async {});
      expect(find.textContaining('Der Server hat gerade ein Problem'), findsOneWidget);
      expect(find.text('Nochmal versuchen'), findsOneWidget);
      await tester.tap(find.text('Mit anderem Team beitreten'));
      await settle(tester, 3);
      await act(tester, () async => tester.tap(find.text('Von vorn beginnen')));
      expect(c.hasSession, isFalse);
      expect(find.text('Event-Karte scannen'), findsOneWidget);
    });
  });

  group('Server-Adresse', () {
    testWidgets('wird beim Tippen geprüft; Weiter bleibt gesperrt', (tester) async {
      phone(tester);
      final (c, s, _) = await game(tester, join: false);
      await tester.pumpWidget(scaled(1, const JoinScreen(), c: c, s: s));
      await settle(tester, 3);
      await tester.enterText(find.byType(TextField).first, 'k7m2qx');
      await settle(tester, 3);
      expect(tester.widget<LKey>(find.widgetWithText(LKey, 'Weiter')).onPressed, isNotNull);

      await tester.tap(find.text('Für Betreuer'));
      await settle(tester, 3);
      final field = find.widgetWithText(TextField, 'Server-Adresse');
      await tester.enterText(field, 'riegel-troisdorf.de/lykora');
      await settle(tester, 3);
      expect(find.text('Die Adresse beginnt mit https://'), findsOneWidget);
      expect(tester.widget<LKey>(find.widgetWithText(LKey, 'Weiter')).onPressed, isNull);

      await tester.enterText(field, 'https://');
      await settle(tester, 3);
      expect(find.textContaining('Diese Adresse stimmt nicht'), findsOneWidget);

      await tester.enterText(field, 'https://example.org/lykora');
      await settle(tester, 3);
      expect(find.text('Die Adresse beginnt mit https://'), findsNothing);
      expect(tester.widget<LKey>(find.widgetWithText(LKey, 'Weiter')).onPressed, isNotNull);
    });

    testWidgets('Leerzeichen und Zeilenumbruch beim Einfügen fallen weg', (tester) async {
      phone(tester);
      final (c, s, _) = await game(tester, join: false);
      await tester.pumpWidget(scaled(1, const JoinScreen(), c: c, s: s));
      await settle(tester, 3);
      await tester.tap(find.text('Für Betreuer'));
      await settle(tester, 3);
      final field = find.widgetWithText(TextField, 'Server-Adresse');
      await tester.enterText(field, ' https://example.org/lykora \n');
      await settle(tester, 3);
      expect(tester.widget<TextField>(field).controller!.text, 'https://example.org/lykora');
    });

    testWidgets('ein eingefügter Link der Event-Karte liefert den Code', (tester) async {
      phone(tester);
      final (c, s, _) = await game(tester, join: false);
      await tester.pumpWidget(scaled(1, const JoinScreen(), c: c, s: s));
      await settle(tester, 3);
      await tester.enterText(find.byType(TextField).first, 'https://example.org/lykora/join/k7m2qx');
      await settle(tester, 3);
      for (final ch in 'K7M2QX'.split('')) {
        expect(find.text(ch), findsOneWidget);
      }
    });
  });

  group('Kamera-Fehlerseite', () {
    testWidgets('Kamera verweigert: deutscher Satz, Einstellungen und Eintippen', (tester) async {
      phone(tester);
      var typed = 0, retried = 0;
      await tester.pumpWidget(
        scaled(
          1,
          Scaffold(
            body: QrScanProblem(
              code: MobileScannerErrorCode.permissionDenied,
              onType: () => typed++,
              onRetry: () => retried++,
            ),
          ),
        ),
      );
      await settle(tester, 3);
      expect(find.text('Die Kamera geht gerade nicht'), findsOneWidget);
      expect(find.textContaining('darf die Kamera nicht benutzen'), findsOneWidget);
      expect(find.text('Einstellungen'), findsOneWidget);
      expect(find.textContaining('permission'), findsNothing, reason: 'kein englischer Systemtext');
      await tester.tap(find.text('Code eintippen'));
      await tester.tap(find.text('Nochmal versuchen'));
      expect(typed, 1);
      expect(retried, 1);
    });

    testWidgets('Kamera nicht vorhanden: nur Eintippen', (tester) async {
      phone(tester);
      var typed = 0;
      await tester.pumpWidget(scaled(1, Scaffold(body: QrScanProblem(code: MobileScannerErrorCode.unsupported, onType: () => typed++))));
      await settle(tester, 3);
      expect(find.textContaining('kann hier nicht scannen'), findsOneWidget);
      expect(find.text('Einstellungen'), findsNothing);
      await tester.tap(find.text('Code eintippen'));
      expect(typed, 1);
    });

    test('scanProblemText kennt jede Fehlerart', () {
      for (final code in MobileScannerErrorCode.values) {
        expect(scanProblemText(code), isNotEmpty);
      }
    });
  });

  group('Codes an Stationen', () {
    testWidgets('unbekannter Code: klarer Satz und Vibration', (tester) async {
      phone(tester);
      final (c, s, _) = await game(tester);
      final buzzes = <Buzz>[];
      Fx.instance.onBuzz = buzzes.add;
      addTearDown(() => Fx.instance.onBuzz = null);
      late BuildContext ctx;
      await tester.pumpWidget(
        scaled(
          1,
          Scaffold(
            body: Builder(
              builder: (context) {
                ctx = context;
                return const SizedBox();
              },
            ),
          ),
          c: c,
          s: s,
        ),
      );
      await act(tester, () async => openByCode(ctx, 'qr', 'https://example.org/irgendwas'));
      expect(find.textContaining('Das ist kein Lykora-Code'), findsOneWidget);
      expect(buzzes, contains(Buzz.pulse));

      await act(tester, () async => openByCode(ctx, 'qr', 'NIXDA'));
      expect(find.textContaining('gehört nicht zu diesem Spiel'), findsOneWidget);
    });

    test('Event-Karte statt Stations-Code wird erkannt', () {
      expect(unknownCodeText('lykora://join?server=https%3A%2F%2Fexample.org%2Flykora&code=K7M2QX'), contains('Event-Karte'));
      expect(unknownCodeText('https://example.org/lykora/join/K7M2QX'), contains('Event-Karte'));
      expect(unknownCodeText('https://example.org/'), contains('kein Lykora-Code'));
      expect(unknownCodeText('XYZ'), contains('nicht zu diesem Spiel'));
    });

    test('Station, die noch nicht dran ist, heißt nicht „keine Station“', () {
      expect(stationRefusedText('hidden'), contains('noch nicht dran'));
      expect(stationRefusedText('paused'), contains('pausiert'));
    });

    testWidgets('getippter Code: Groß- und Kleinschreibung und Leerzeichen zählen nicht', (tester) async {
      phone(tester);
      final (c, _, _) = await game(tester);
      expect(codeTypeFor(c, ' 4711 '), 'manual', reason: 'Betreuer-Code des Beispielspiels');
      expect(codeTypeFor(c, 'LYK-BRIEFING'), 'qr');
      expect(codeTypeFor(c, 'gibt-es-nicht'), 'qr');
    });
  });

  group('Schrift und Breite', () {
    for (final width in [320.0, 360.0, 412.0]) {
      for (final scale in [1.0, 1.6, 2.0]) {
        testWidgets('Einstieg bei ${width.round()} dp und ${(scale * 100).round()} % läuft nicht über', (tester) async {
          phone(tester, width: width, height: 640);
          final (c, s, _) = await game(tester, join: false);
          await tester.pumpWidget(scaled(scale, const JoinScreen(), c: c, s: s));
          await settle(tester, 3);
          await reveal(tester, find.byType(CodeBoxes), 100);
          await tester.enterText(find.byType(TextField).first, 'k7m2qx');
          await reveal(tester, find.text('Für Betreuer'), 100);
          await tester.tap(find.text('Für Betreuer'));
          await settle(tester, 3);
          // ungültige Adresse zeigt den längsten Fehlertext
          await reveal(tester, find.widgetWithText(TextField, 'Server-Adresse'), 100);
          await tester.enterText(find.widgetWithText(TextField, 'Server-Adresse'), 'kaputt');
          await settle(tester, 3);
          expect(tester.takeException(), isNull);
          await reveal(tester, find.byType(CodeBoxes), -100);
          expect(tester.getSize(find.byType(CodeBoxes)).width, lessThanOrEqualTo(width));
          expect(find.text('K'), findsOneWidget);
        });

        testWidgets('Team anlegen bei ${width.round()} dp und ${(scale * 100).round()} % läuft nicht über', (tester) async {
          phone(tester, width: width, height: 640);
          final (c, s, server) = await game(tester, join: false);
          server.captivePortal = true; // längster Fehlertext am Ende
          await tester.pumpWidget(scaled(scale, const TeamSetupScreen(server: address, code: 'K7M2QX'), c: c, s: s));
          await settle(tester, 3);
          expect(tester.takeException(), isNull);
          await reveal(tester, find.text('Team Glühwürmchen'), 100);
          await tester.tap(find.text('Team Glühwürmchen'));
          await settle(tester, 3);
          await tester.tap(find.text('Weiter'));
          await settle(tester, 3);
          expect(tester.takeException(), isNull);
          await tester.tap(find.text('Weiter'));
          await settle(tester, 3);
          expect(tester.takeException(), isNull);
          await submit(tester);
          expect(find.textContaining('Hier antwortet kein Lykora-Server'), findsOneWidget);
          expect(tester.takeException(), isNull);
        });
      }
    }

    testWidgets('Kamera-Fehlerseite läuft bei 200 % auf 320 dp nicht über', (tester) async {
      phone(tester, width: 320, height: 640);
      await tester.pumpWidget(
        scaled(2, Scaffold(body: QrScanProblem(code: MobileScannerErrorCode.permissionDenied, onType: () {}, onRetry: () {}, onClose: () {}))),
      );
      await settle(tester, 3);
      expect(tester.takeException(), isNull);
    });
  });
}
