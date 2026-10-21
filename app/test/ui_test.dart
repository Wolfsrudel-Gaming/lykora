// Rendert die wichtigsten Bildschirme und bedient sie wie ein Team.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/ui/screens/home_screen.dart';
import 'package:lykora/ui/screens/join_screen.dart';
import 'package:lykora/ui/screens/map_tab.dart';
import 'package:lykora/ui/screens/prep_screen.dart';
import 'package:lykora/ui/screens/sos_screen.dart';
import 'package:lykora/ui/screens/station_screen.dart';

import 'support.dart';

Future<(GameController, AppSettings)> _setup(WidgetTester tester, {bool join = true}) async {
  final server = FakeServer();
  late GameController c;
  late AppSettings settings;
  await tester.runAsync(() async {
    final dir = await Directory.systemTemp.createTemp('lykora-ui-');
    final store = SessionStore(dir);
    c = GameController(
      store: store,
      apiFactory: (s, t) => Api(s, token: t, client: server.client()),
    );
    if (join) await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
    settings = AppSettings(store);
  });
  return (c, settings);
}

Widget _wrap(GameController c, AppSettings s, Widget child) => Lykora(
  controller: c,
  settings: s,
  child: MaterialApp(home: child),
);

void main() {
  setUp(() => MapTab.showTiles = false);

  testWidgets('ohne Sitzung startet die App beim Einstieg', (tester) async {
    final (c, s) = await _setup(tester, join: false);
    await tester.pumpWidget(LykoraApp(controller: c, settings: s));
    expect(find.byType(JoinScreen), findsOneWidget);
    expect(find.text('Event-QR scannen'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'k7m2qx');
    await tester.tap(find.text('Weiter'));
    await tester.pumpAndSettle();
    expect(find.byType(TeamSetupScreen), findsOneWidget);
    expect(find.text('Teamname'), findsOneWidget);
  });

  testWidgets('Vorbereitung zeigt Checkliste, Einsatzbefehl und Ausrüstung', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.pumpWidget(LykoraApp(controller: c, settings: s));
    await tester.pump();
    expect(find.byType(PrepScreen), findsOneWidget);
    expect(find.text('Einsatzbefehl'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Warnweste'), 200);
    expect(find.text('Warnweste'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Erst Ausrüstung abhaken'), 200);
    await tester.tap(find.text('Lampe'));
    await tester.tap(find.text('Warnweste'));
    await tester.pump();
    expect(find.text('Abenteuer starten'), findsOneWidget);
    c.stopLoops();
  });

  testWidgets('Hauptbildschirm mit allen Tabs', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() => c.start());
    await tester.pumpWidget(LykoraApp(controller: c, settings: s));
    await tester.pump();
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.text('SOS'), findsOneWidget);
    for (final tab in ['Stationen', 'Rucksack', 'Zentrale', 'Karte']) {
      await tester.tap(find.text(tab).last);
      await tester.pump();
    }
    await tester.tap(find.text('Stationen').last);
    await tester.pump();
    expect(find.text('Sicherheits-Briefing'), findsOneWidget);
    expect(find.text('Das Versteck'), findsNothing);
    c.stopLoops();
  });

  testWidgets('Station lösen über die Oberfläche', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() async {
      await c.start();
      await c.trigger('baum', 'gps');
    });
    await tester.pumpWidget(_wrap(c, s, const StationScreen(stationId: 'baum')));
    await tester.pump();
    expect(find.text('Hier wurde das Funkgerät zuletzt gesehen.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Fuchs');
    await tester.runAsync(() async {
      await tester.tap(find.text('Prüfen'));
      await Future<void>.delayed(const Duration(milliseconds: 200));
    });
    await tester.pump();
    expect(c.state.wrongAnswers, 1);
    await tester.enterText(find.byType(TextField), 'Eule');
    await tester.runAsync(() async {
      await tester.tap(find.text('Prüfen'));
      await Future<void>.delayed(const Duration(milliseconds: 200));
    });
    await tester.pump();
    expect(c.state.solved.keys, contains('baum'));
    expect(find.text('Gelöst'), findsOneWidget);
    c.stopLoops();
  });

  testWidgets('Multiple Choice und Hinweise', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.runAsync(() async {
      await c.start();
      await c.trigger('briefing', 'qr');
    });
    await tester.pumpWidget(_wrap(c, s, const StationScreen(stationId: 'briefing')));
    await tester.pump();
    await tester.tap(find.text('SOS drücken und bei der Person bleiben'));
    await tester.pump();
    await tester.runAsync(() async {
      await tester.tap(find.text('Prüfen'));
      await Future<void>.delayed(const Duration(milliseconds: 200));
    });
    await tester.pump();
    expect(c.state.solved.keys, contains('briefing'));
    c.stopLoops();
  });

  testWidgets('SOS braucht langes Drücken', (tester) async {
    final (c, s) = await _setup(tester);
    await tester.pumpWidget(_wrap(c, s, const SosScreen()));
    expect(find.text('2 Sekunden gedrückt halten'), findsOneWidget);
    expect(find.textContaining('112 anrufen'), findsOneWidget);
    // Kurzes Tippen löst nichts aus.
    await tester.tap(find.text('SOS').last);
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('2 Sekunden gedrückt halten'), findsOneWidget);
  });
}
