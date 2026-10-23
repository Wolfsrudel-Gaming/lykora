// Abschlussbildschirm: Spielende durch die Spielleitung, Ziel erreicht, Zusammenfassung, Auflösung, Rang und Daten löschen.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/services/fx.dart';
import 'package:lykora/ui/screens/ende_screen.dart';
import 'package:lykora/ui/screens/home_screen.dart';
import 'package:lykora/ui/design/tokens.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';

import 'loop_support.dart';
import 'support.dart';

void main() {
  setUpAll(() async {
    await loadAppFonts();
    GameMap.showTiles = false;
    PrepScreen.skipPacking = true;
  });

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized().defaultBinaryMessenger.setMockStreamHandler(
      const EventChannel('com.llfbandor.app_links/events'),
      MockStreamHandler.inline(onListen: (_, _) {}),
    );
  });

  group('Abschluss', () {
    Future<void> finishGame(Rig r) => r.c.start().then((_) async {
      for (final (id, answer) in [
        ('baum', {'text': 'Eule'}),
        ('schloss', {'text': '372'}),
        ('versteck', {'upload': 'foto'}),
      ]) {
        await r.c.trigger(id, 'qr');
        await r.c.answer(id, answer);
      }
      await r.c.trigger('finale', 'qr');
      await r.c.answer('finale', {'text': r.c.game!.fragments.map((f) => f.value).join()});
    });

    testWidgets('Spielleitung beendet: Abschluss erscheint von selbst, einmal, und bleibt erreichbar', (tester) async {
      final r = await rig(tester);
      await tester.pumpWidget(app(r));
      await settle(tester);
      final buzzes = <Buzz>[];
      Fx.instance.onBuzz = buzzes.add;
      r.server.status = 'ended';
      await act(tester, () => r.c.sync());
      await settle(tester);
      expect(find.byType(EndeScreen), findsOneWidget);
      expect(textI('Spiel beendet'), findsWidgets);
      expect(textI('Zeit'), findsOneWidget);
      expect(textI('Stationen'), findsOneWidget);
      expect(textContainsI('von ${r.c.game!.stations.length}'), findsOneWidget);
      expect(textContainsI('Danke, dass ihr dabei wart'), findsOneWidget);
      expect(find.text('Daten auf diesem Handy löschen'), findsOneWidget);
      expect(buzzes.where((b) => b == Buzz.arrival), hasLength(1), reason: 'einmal Zeichen beim Ende');
      expect(textContainsI('Auflösung'), findsNothing, reason: 'ohne Ziel keine Auflösung der Geschichte');

      // Zurück zum Spiel: Der Abschluss kommt nicht noch einmal, ist aber über die Karte und das Menü erreichbar.
      await tester.tap(find.text('Zurück'));
      await settle(tester, 15);
      expect(find.byType(EndeScreen), findsNothing);
      expect(find.byType(HomeScreen), findsOneWidget);
      await act(tester, () => r.c.sync());
      expect(find.byType(EndeScreen), findsNothing);
      expect(find.text('Zum Abschluss'), findsWidgets, reason: 'Karte unter dem Kopf und Peiler führen hin');
      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await settle(tester);
      await tester.tap(find.text('Abschluss'));
      await settle(tester, 15);
      expect(find.byType(EndeScreen), findsOneWidget);
    });

    testWidgets('Ziel erreicht: Zusammenfassung, Auflösung, Platz; wartet, bis die Seite obenauf ist', (tester) async {
      final r = await rig(tester);
      await tester.pumpWidget(app(r));
      await settle(tester);
      // Das Team steht noch in einer Station, als es das Finale löst.
      navigatorKey.currentState!.push(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('Station offen'))));
      await settle(tester);
      r.server.leaderboard = [
        {'rank': 1, 'name': 'Wölfe', 'points': 400, 'own': false, 'finished': true},
        {'rank': 2, 'name': 'Füchse', 'points': 350, 'own': true, 'finished': true},
      ];
      await tester.runAsync(() async {
        await finishGame(r);
        await r.c.sync();
      });
      await settle(tester);
      expect(r.c.finished, isTrue);
      expect(find.byType(EndeScreen), findsNothing, reason: 'Belohnung und Auflösung der Station werden nicht abgeschnitten');
      navigatorKey.currentState!.pop();
      await settle(tester, 15);
      expect(find.byType(EndeScreen), findsOneWidget);
      expect(textI('Geschafft!'), findsWidgets);
      expect(textContainsI('Nachtfalke hört euch laut und klar'), findsOneWidget, reason: 'Auflösung der Geschichte');
      expect(textI('Teile'), findsOneWidget);
      expect(textContainsI('${r.c.game!.fragments.length} von ${r.c.game!.fragments.length}'), findsOneWidget);
      expect(textI('Punkte'), findsOneWidget, reason: 'Wettbewerb');
      expect(textI('Platz'), findsOneWidget);
      expect(textContainsI('2 von 2'), findsOneWidget);
      expect(textI('Zeit'), findsOneWidget);
    });

    testWidgets('Daten auf diesem Handy löschen: erst fragen und Wartendes zeigen, Abbrechen lässt alles', (tester) async {
      final r = await rig(tester);
      await tester.pumpWidget(app(r));
      await settle(tester);
      r.server.status = 'ended';
      await act(tester, () => r.c.sync());
      await settle(tester, 15);
      expect(find.byType(EndeScreen), findsOneWidget);
      expect(textContainsI('wartet noch auf Empfang'), findsNothing);
      r.server.online = false;
      await tester.runAsync(() async {
        await r.c.trigger('schloss', 'qr');
      });
      await settle(tester);
      expect(textContainsI('Eine Meldung wartet noch auf Empfang'), findsOneWidget, reason: 'Wartendes steht auf dem Abschluss');
      await tester.tap(find.text('Daten auf diesem Handy löschen'));
      await settle(tester, 15);
      expect(textContainsI('noch nicht an die Spielleitung übertragen'), findsOneWidget, reason: 'Warnung vor dem Löschen');
      await tester.tap(find.text('Abbrechen'));
      await settle(tester, 15);
      expect(r.c.hasSession, isTrue, reason: 'abgebrochen');
      expect(find.byType(EndeScreen), findsOneWidget);
    });

    testWidgets('Daten auf diesem Handy löschen: Team verlässt das Handy, die Seite schließt sich', (tester) async {
      // Ohne die ganze App: Der Einstieg würde die Plattform-Schnittstelle für App-Links brauchen, die hier nicht zur Debatte steht.
      final r = await rig(tester);
      await tester.runAsync(() => r.c.sync());
      await tester.pumpWidget(
        Lykora(
          controller: r.c,
          settings: r.settings,
          child: MaterialApp(
            theme: buildTheme(r.settings.tokensFor(r.c.game)),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(onPressed: () => openEnde(context), child: const Text('Start')),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Start'));
      await settle(tester, 15);
      expect(find.byType(EndeScreen), findsOneWidget);
      await tester.tap(find.text('Daten auf diesem Handy löschen'));
      await settle(tester, 15);
      await tester.tap(find.text('Löschen und Team verlassen'));
      await settle(tester, 30);
      expect(r.c.hasSession, isFalse);
      expect(r.location.running, isFalse);
      expect(find.byType(EndeScreen), findsNothing, reason: 'die Seite schließt sich, die App fällt auf den Einstieg zurück');
      expect(find.text('Start'), findsOneWidget);
    });
  });

  testWidgets('Abschluss bei 200 % Schrift auf 320 dp breitem Handy ohne Überlauf', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearAllTestValues);
    final r = await rig(tester, width: 320);
    await tester.pumpWidget(app(r));
    await settle(tester);
    final probe = ErrorProbe();
    addTearDown(probe.restore);
    r.server.status = 'ended';
    await act(tester, () => r.c.sync());
    await settle(tester, 15);
    probe.check('Überlauf im Abschluss');
    expect(find.byType(EndeScreen), findsOneWidget);
    await tester.drag(find.byType(ListView).last, const Offset(0, -600));
    await settle(tester);
    probe.check('Überlauf im Abschluss nach dem Scrollen');
  });
}
