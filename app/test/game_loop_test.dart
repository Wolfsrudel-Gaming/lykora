// Spielschleife: Neuaufbauten pro Sekunde, Peiler unter Seiten und im Hintergrund, veraltete Position,
// Pause und Funkloch, Schriftmatrix, Bildschirm an und die Wartungsfälle im Abgleich.

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/services/fx.dart';
import 'package:lykora/services/live.dart';
import 'package:lykora/services/location.dart';
import 'package:lykora/services/soundscape.dart';
import 'package:lykora/ui/design/components.dart';
import 'package:lykora/ui/design/tokens.dart';
import 'package:lykora/ui/screens/akte_tab.dart';
import 'package:lykora/ui/screens/funk_tab.dart';
import 'package:lykora/ui/screens/home_screen.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/peiler_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';
import 'package:lykora/ui/screens/station_screen.dart';
import 'package:lykora/ui/story/beats.dart';

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
      const EventChannel('com.llfbandit.app_links/events'),
      MockStreamHandler.inline(onListen: (_, _) {}),
    );
  });

  group('Neuaufbauten', () {
    testWidgets('verdeckte Tabs bauen bei Takt und Positionsmeldungen nicht neu, der sichtbare schon', (tester) async {
      final r = await rig(tester);
      await tester.pumpWidget(app(r));
      await settle(tester);
      expect(find.byType(FunkTab, skipOffstage: false), findsNothing, reason: 'Funk und Akte werden erst beim ersten Öffnen gebaut');
      expect(find.byType(AkteTab, skipOffstage: false), findsNothing);
      await tester.tap(find.text('Funk'));
      await settle(tester);
      await tester.tap(find.text('Einsatzprotokoll'));
      await settle(tester);
      await tester.tap(find.text('Weg'));
      await settle(tester);
      expect(find.byType(FunkTab, skipOffstage: false), findsOneWidget, reason: 'bleibt mit seinem Zustand im Hintergrund');
      expect(find.byType(AkteTab, skipOffstage: false), findsOneWidget);
      expect(find.byType(FunkTab), findsNothing, reason: 'nicht zu sehen');

      var hidden = 0;
      var peiler = 0;
      var total = 0;
      debugOnRebuildDirtyWidget = (Element e, bool builtOnce) {
        total++;
        if (e.widget is FunkTab || e.widget is AkteTab) hidden++;
        var under = false;
        e.visitAncestorElements((a) {
          if (a.widget is FunkTab || a.widget is AkteTab) under = true;
          if (a.widget is PeilerView) peiler++;
          return !under;
        });
        if (under) hidden++;
      };
      addTearDown(() => debugOnRebuildDirtyWidget = null);
      for (var i = 0; i < 6; i++) {
        await tester.runAsync(() => fixFar(r));
        r.clock.advance(const Duration(seconds: 1));
        r.c.tick();
        await tester.pump(const Duration(seconds: 1));
      }
      debugOnRebuildDirtyWidget = null;
      expect(hidden, 0, reason: 'Funk und Akte liegen hinten: keine Arbeit pro Sekunde');
      expect(peiler, greaterThan(0), reason: 'der sichtbare Peiler folgt der Position');
      // Im Leerlauf (ohne neue Fixes) tickt nichts außer der Uhr: Vorher waren es rund 420 Elemente pro Sekunde.
      var idle = 0;
      debugOnRebuildDirtyWidget = (e, _) => idle++;
      for (var i = 0; i < 5; i++) {
        r.clock.advance(const Duration(seconds: 1));
        r.c.tick();
        await tester.pump(const Duration(seconds: 1));
      }
      debugOnRebuildDirtyWidget = null;
      // Gemessen: etwa ein Element pro Sekunde, vorher rund 420.
      expect(idle / 5, lessThan(10), reason: 'Neuaufbauten pro Sekunde im Leerlauf, gemessen: ${idle / 5} (vorher etwa 420)');
      expect(total, greaterThan(0));
    });

    testWidgets('was verdeckt geschah, steht beim Öffnen des Tabs da', (tester) async {
      final r = await rig(tester);
      await tester.pumpWidget(app(r));
      await settle(tester);
      await tester.tap(find.text('Funk'));
      await settle(tester);
      await tester.tap(find.text('Weg'));
      await settle(tester);
      r.server.pendingMessages.add({'kind': 'chat', 'body': 'Nachtfalke an Team: Weiter so!'});
      await act(tester, () => r.c.sync());
      expect(
        find.descendant(of: find.byType(FunkTab, skipOffstage: false), matching: find.text('Nachtfalke an Team: Weiter so!', skipOffstage: false)),
        findsNothing,
        reason: 'der verdeckte Tab rechnet nicht mit',
      );
      await tester.tap(find.bySemanticsLabel('Funk, 1 neu'));
      await settle(tester);
      expect(find.descendant(of: find.byType(FunkTab), matching: find.text('Nachtfalke an Team: Weiter so!')), findsOneWidget);
    });

    testWidgets('Restzeit baut nur neu, wenn sich ihr Text ändert', (tester) async {
      final r = await rig(tester);
      await tester.pumpWidget(app(r));
      await settle(tester);
      expect(textContainsI('Min.'), findsWidgets, reason: 'grobe Restzeit, z. B. ~ 45 Min.');
      var rebuilds = 0;
      debugOnRebuildDirtyWidget = (e, _) {
        if (e.widget is RemainingTime) rebuilds++;
      };
      addTearDown(() => debugOnRebuildDirtyWidget = null);
      for (var i = 0; i < 10; i++) {
        r.clock.advance(const Duration(seconds: 1));
        r.c.tick();
        await tester.pump(const Duration(seconds: 1));
      }
      expect(rebuilds, 0, reason: 'zehn Sekunden, derselbe Text');
      // Letzte zehn Minuten: genau, jede Sekunde ein anderer Text.
      r.clock.advance(const Duration(seconds: 2150));
      r.c.tick();
      await tester.pump(const Duration(seconds: 1));
      rebuilds = 0;
      for (var i = 0; i < 5; i++) {
        r.clock.advance(const Duration(seconds: 1));
        r.c.tick();
        await tester.pump(const Duration(seconds: 1));
      }
      expect(rebuilds, 5);
      expect(textContainsI('Noch '), findsOneWidget);
    });
  });

  group('Peiler obenauf und im Vordergrund', () {
    Future<Rig> nearBaum(WidgetTester tester, {double width = 412}) async {
      final r = await rig(tester, width: width);
      r.c.choosePeilTarget('baum');
      await tester.runAsync(() => fixNearBaum(r, 45));
      await tester.pumpWidget(app(r));
      await settle(tester);
      return r;
    }

    testWidgets('pulst im Vordergrund, schweigt unter einer Station und pulst danach wieder', (tester) async {
      await nearBaum(tester);
      final buzzes = <Buzz>[];
      Fx.instance.onBuzz = buzzes.add;
      expect(textI('Nah'), findsOneWidget);
      await elapse(tester, 7);
      final first = buzzes.where((b) => b == Buzz.pulse).length;
      expect(first, greaterThanOrEqualTo(2), reason: 'alle 3 s im Nahbereich');

      // Eine Station liegt darüber: nichts pulst, nichts vibriert.
      final nav = navigatorKey.currentState!;
      nav.push(FadeRoute<void>(builder: (_) => const Scaffold(body: Text('Darüber'))));
      await settle(tester, 8);
      buzzes.clear();
      await elapse(tester, 12);
      expect(buzzes.where((b) => b == Buzz.pulse), isEmpty, reason: 'Peiler-Takt unter überdeckender Route aus');

      nav.pop();
      await settle(tester, 8);
      buzzes.clear();
      await elapse(tester, 7);
      expect(buzzes.where((b) => b == Buzz.pulse).length, greaterThanOrEqualTo(2), reason: 'wieder obenauf: weiter im Takt');
    });

    testWidgets('pulst nicht auf einem anderen Tab', (tester) async {
      final r = await nearBaum(tester);
      final buzzes = <Buzz>[];
      Fx.instance.onBuzz = buzzes.add;
      await tester.tap(find.text('Funk'));
      await settle(tester);
      buzzes.clear();
      await elapse(tester, 10);
      expect(buzzes.where((b) => b == Buzz.pulse), isEmpty);
      await tester.tap(find.text('Weg'));
      await settle(tester);
      buzzes.clear();
      await elapse(tester, 7);
      expect(buzzes.where((b) => b == Buzz.pulse), isNotEmpty);
      expect(r.c.state.triggered, isEmpty);
    });

    testWidgets('im Hintergrund still, im Taschenmodus nicht', (tester) async {
      final r = await nearBaum(tester);
      final buzzes = <Buzz>[];
      Fx.instance.onBuzz = buzzes.add;

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      buzzes.clear();
      await elapse(tester, 10);
      expect(buzzes.where((b) => b == Buzz.pulse), isEmpty, reason: 'App im Hintergrund, kein Taschenmodus');

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await settle(tester);
      expect(r.c.resumed, 1, reason: 'beim Zurückkehren gleich abgleichen');
      buzzes.clear();
      await elapse(tester, 7);
      expect(buzzes.where((b) => b == Buzz.pulse), isNotEmpty, reason: 'zurück im Vordergrund');

      // Taschenmodus: Bildschirm sperren, Vibration führt weiter.
      await tester.tap(find.text('Einstecken'));
      await settle(tester);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      buzzes.clear();
      await elapse(tester, 7);
      expect(buzzes.where((b) => b == Buzz.pulse).length, greaterThanOrEqualTo(2), reason: 'Taschenmodus führt im Hintergrund weiter');
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await settle(tester);
    });

    testWidgets('pausiertes Spiel: kein Puls', (tester) async {
      final r = await nearBaum(tester);
      final buzzes = <Buzz>[];
      r.server.status = 'paused';
      await act(tester, () => r.c.sync());
      Fx.instance.onBuzz = buzzes.add;
      await elapse(tester, 10);
      expect(buzzes.where((b) => b == Buzz.pulse), isEmpty);
    });

    testWidgets('veraltete Position: „Ortung veraltet“ mit Alter, keine Stufe, kein Puls', (tester) async {
      final r = await rig(tester);
      r.c.choosePeilTarget('baum');
      await tester.runAsync(() => fixNearBaum(r, 45, at: DateTime.fromMillisecondsSinceEpoch(r.clock.ms).subtract(const Duration(minutes: 3))));
      expect(r.c.positionStale, isTrue);
      await tester.pumpWidget(app(r));
      await settle(tester);
      final buzzes = <Buzz>[];
      Fx.instance.onBuzz = buzzes.add;
      expect(textI('Ortung veraltet'), findsWidgets);
      expect(textContainsI('vor 3 Min.'), findsOneWidget, reason: 'Alter der letzten Position');
      expect(textI('Nah'), findsNothing, reason: 'eine alte Position zeigt keine Stufe');
      expect(find.bySemanticsLabel(RegExp('Peilscheibe: Ortung veraltet')), findsOneWidget);
      await elapse(tester, 10);
      expect(buzzes.where((b) => b == Buzz.pulse), isEmpty);

      // Frischer Fix: Stufe und Puls kehren zurück.
      await tester.runAsync(() => fixNearBaum(r, 45));
      await settle(tester);
      expect(textI('Nah'), findsOneWidget);
      expect(textI('Ortung veraltet'), findsNothing);
      await elapse(tester, 7);
      expect(buzzes.where((b) => b == Buzz.pulse), isNotEmpty);
    });

    testWidgets('Ortung ohne frischen Fix weckt keine Station, auch nicht über die Taste', (tester) async {
      final r = await rig(tester);
      r.c.choosePeilTarget('baum');
      await tester.runAsync(() => fixNearBaum(r, 5, at: DateTime.now().subtract(const Duration(minutes: 5))));
      await tester.pumpWidget(app(r));
      await settle(tester);
      expect(r.c.state.triggered, isEmpty, reason: 'ein alter Fix löst nichts aus');
      expect(find.text('Station wecken'), findsNothing);
      await tester.runAsync(() => fixNearBaum(r, 5));
      await settle(tester, 20);
      expect(r.c.state.triggered, contains('baum'), reason: 'ein frischer schon');
    });
  });

  group('Wir sind da', () {
    testWidgets('braucht eine frische Position', (tester) async {
      final r = await rig(tester, game: gameWithFindLocation());
      await tester.runAsync(() async {
        await r.c.trigger('briefing', 'qr');
        await r.c.markSceneSeen('briefing');
        await r.c.onPosition(50.8156, 7.1552, 5, at: DateTime.now().subtract(const Duration(minutes: 2)));
      });
      await tester.pumpWidget(
        Lykora(
          controller: r.c,
          settings: r.settings,
          child: MaterialApp(
            theme: buildTheme(r.settings.tokensFor(r.c.game)),
            home: const StationScreen(stationId: 'briefing'),
          ),
        ),
      );
      await settle(tester);
      LKey key() => tester.widgetList<LKey>(find.byType(LKey)).firstWhere((k) => k.label == 'Wir sind da');
      expect(key().onPressed, isNull, reason: 'alte Position: gesperrt');
      expect(key().reason, contains('Ortung veraltet'));
      expect(textContainsI('veraltet'), findsWidgets);

      await tester.runAsync(() => r.c.onPosition(50.8156, 7.1552, 5));
      await settle(tester);
      expect(key().onPressed, isNotNull, reason: 'frische Position: frei');
      await act(tester, () async => tester.tap(find.text('Wir sind da')));
      expect(r.c.state.solved.keys, contains('briefing'));
    });
  });

  group('Lebenszyklus und Ortung', () {
    testWidgets('Ortung startet mit onError der Steuerung; Fehler erscheinen als Hinweis', (tester) async {
      final r = await rig(tester);
      await tester.pumpWidget(app(r));
      await settle(tester);
      expect(r.location.starts, 1);
      expect(r.location.onError, r.c.onPositionError, reason: 'Fehler des Ortungsstroms gehen an die Steuerung');
      expect(textI('Keine Ortung'), findsNothing);
      r.location.onError!(StateError('aus'));
      await settle(tester);
      expect(r.c.locationError, isNotNull);
      expect(textI('Keine Ortung'), findsOneWidget);
      expect(textContainsI('Standort eingeschaltet'), findsOneWidget);
      await tester.runAsync(() => fixFar(r));
      await settle(tester);
      expect(textI('Keine Ortung'), findsNothing, reason: 'der nächste Fix löscht den Fehler');
    });

    testWidgets('beim Zurückkehren: abgleichen, Ortung neu aufnehmen', (tester) async {
      final r = await rig(tester);
      r.location.state = LocationState.denied;
      await tester.pumpWidget(app(r));
      await settle(tester);
      expect(r.location.starts, 0, reason: 'Erlaubnis fehlt');
      // In den Systemeinstellungen erlaubt, zurück in die App.
      r.location.state = LocationState.ready;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await settle(tester);
      expect(r.c.resumed, 1);
      expect(r.location.starts, 1);

      // Läuft die Ortung, aber der Strom hat einen Fehler gemeldet: neu aufbauen.
      r.location.onError!(StateError('weg'));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await settle(tester);
      expect(r.c.resumed, 2);
      expect(r.location.restarts, 1);
    });
  });

  group('Pause, Ende und Funkloch', () {
    testWidgets('Pause: deutliche Karte, einmal Vibration, danach Entwarnung', (tester) async {
      final r = await rig(tester);
      await tester.pumpWidget(app(r));
      await settle(tester);
      final buzzes = <Buzz>[];
      final sounds = <Sound>[];
      Fx.instance
        ..onBuzz = buzzes.add
        ..onPlay = sounds.add;
      expect(textI('Pause'), findsNothing);
      r.server.status = 'paused';
      await act(tester, () => r.c.sync());
      expect(textI('Pause'), findsOneWidget);
      expect(textContainsI('Eure Zeit steht'), findsOneWidget);
      expect(buzzes.where((b) => b == Buzz.arrival), hasLength(1));
      expect(sounds, contains(Sound.squelchOn));
      await act(tester, () => r.c.sync());
      await act(tester, () => r.c.sync());
      expect(buzzes.where((b) => b == Buzz.arrival), hasLength(1), reason: 'der Hinweis kommt einmal, nicht bei jedem Abgleich');

      r.server.status = 'running';
      await act(tester, () => r.c.sync());
      expect(textI('Pause'), findsNothing);
      expect(buzzes.where((b) => b == Buzz.pulse), hasLength(1), reason: 'kurzes Zeichen, wenn es weitergeht');
    });

    testWidgets('Spielleitung nicht erreichbar: erst nach zwei Minuten, einmal Hinweis, weg bei Kontakt', (tester) async {
      final r = await rig(tester);
      await tester.pumpWidget(app(r));
      await settle(tester);
      final buzzes = <Buzz>[];
      Fx.instance.onBuzz = buzzes.add;
      r.server.online = false;
      await act(tester, () => r.c.sync());
      expect(r.c.online, isFalse);
      expect(textI('Spielleitung nicht erreichbar'), findsNothing, reason: 'ein kurzes Funkloch ist normal');

      r.clock.advance(const Duration(minutes: 3));
      r.c.tick();
      await settle(tester);
      expect(textI('Spielleitung nicht erreichbar'), findsOneWidget);
      expect(textContainsI('Seit 3 Min. kein Kontakt'), findsOneWidget);
      expect(buzzes.where((b) => b == Buzz.pulse), hasLength(1));

      r.clock.advance(const Duration(minutes: 1));
      r.c.tick();
      await settle(tester);
      expect(textContainsI('Seit 4 Min. kein Kontakt'), findsOneWidget, reason: 'zählt mit');
      expect(buzzes.where((b) => b == Buzz.pulse), hasLength(1), reason: 'der Hinweis kommt nur einmal');

      r.server.online = true;
      await act(tester, () => r.c.sync());
      expect(textI('Spielleitung nicht erreichbar'), findsNothing);
    });

    testWidgets('Pause und Funkloch stehen auch in der Station', (tester) async {
      final r = await rig(tester);
      await tester.runAsync(() async {
        await r.c.trigger('baum', 'qr');
        await r.c.markSceneSeen('baum');
      });
      await tester.pumpWidget(app(r));
      await settle(tester);
      navigatorKey.currentState!.push(MaterialPageRoute<void>(builder: (_) => const StationScreen(stationId: 'baum')));
      await settle(tester);
      r.server.status = 'paused';
      await act(tester, () => r.c.sync());
      expect(textI('Pause'), findsOneWidget, reason: 'auch auf der Stationsseite, nicht nur darunter');
    });
  });

  group('Schriftmatrix', () {
    for (final width in [320.0, 360.0, 412.0]) {
      for (final scale in [1.0, 1.6, 2.0]) {
        testWidgets('Spielrahmen mit vier Werkzeugtasten bei ${(scale * 100).round()} % Schrift, ${width.round()} dp breit', (tester) async {
          tester.platformDispatcher.textScaleFactorTestValue = scale;
          addTearDown(tester.platformDispatcher.clearAllTestValues);
          final probe = ErrorProbe();
          addTearDown(probe.restore);
          final r = await rig(tester, width: width);
          r.c.choosePeilTarget('baum');
          // Schlechtester Fall in der Kopfzeile: letzte zehn Minuten (Zeit in großer Zahl) und alle Schlüsselplätze.
          r.clock.advance(const Duration(seconds: 2150));
          r.c.tick();
          await tester.runAsync(() async {
            await r.c.heartbeat();
            await fixNearBaum(r, 45);
          });
          await tester.pumpWidget(app(r));
          await settle(tester);
          probe.check('Überlauf im Spielrahmen');
          for (final label in ['QR', 'NFC', 'Code', 'Einstecken']) {
            final rect = tester.getRect(find.text(label));
            expect(rect.left, greaterThanOrEqualTo(0), reason: '$label links im Bild');
            expect(rect.right, lessThanOrEqualTo(width), reason: '$label rechts im Bild');
          }
          // Die Tasten stehen nebeneinander, alle vier.
          expect({
            for (final l in ['QR', 'NFC', 'Code', 'Einstecken']) tester.getRect(find.text(l)).left,
          }, hasLength(4));
          for (final tab in ['Weg', 'Funk', 'Einsatzprotokoll']) {
            expect(find.text(tab), findsOneWidget);
          }
          // Karte und Liste ebenfalls ohne Überlauf.
          for (final tab in ['Liste', 'Karte', 'Funk', 'Einsatzprotokoll']) {
            await tester.tap(find.text(tab));
            await settle(tester);
            probe.check('Überlauf nach dem Wechsel zu $tab');
          }
        });
      }
    }
  });

  group('Schriftmatrix Pause', () {
    testWidgets('Pause-Karte und Funkloch-Karte bei 200 % Schrift auf 320 dp breitem Handy ohne Überlauf', (tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2.0;
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      final r = await rig(tester, width: 320);
      await tester.pumpWidget(app(r));
      await settle(tester);
      final probe = ErrorProbe();
      addTearDown(probe.restore);
      r.server.status = 'paused';
      await act(tester, () => r.c.sync());
      probe.check('Überlauf mit Pause-Karte');
      probe.restore();
      expect(textI('Pause'), findsOneWidget);
      final probe2 = ErrorProbe();
      addTearDown(probe2.restore);
      r.server.status = 'running';
      await act(tester, () => r.c.sync());
      r.server.online = false;
      await act(tester, () => r.c.sync());
      r.clock.advance(const Duration(minutes: 5));
      r.c.tick();
      await settle(tester);
      probe2.check('Überlauf mit Funkloch-Karte');
      probe2.restore();
      expect(textI('Spielleitung nicht erreichbar'), findsOneWidget);
    });
  });

  group('Bildschirm bleibt an', () {
    late List<bool> calls;

    setUp(() {
      calls = [];
      ScreenAwake.driver = (on) async => calls.add(on);
    });
    tearDown(ScreenAwake.reset);

    testWidgets('Szene, Vorlesemodus und Rätsel lassen die Sperre in Ruhe', (tester) async {
      final r = await rig(tester);
      await tester.runAsync(() async {
        await r.c.trigger('baum', 'qr');
      });
      await tester.pumpWidget(app(r));
      await settle(tester);
      expect(ScreenAwake.wanted, isTrue);
      calls.clear();
      navigatorKey.currentState!.push(MaterialPageRoute<void>(builder: (_) => const StationScreen(stationId: 'baum')));
      await settle(tester);
      expect(find.textContaining('Hier wurde das Funkgerät zuletzt gesehen.'), findsOneWidget, reason: 'Szene offen');
      expect(ScreenAwake.wanted, isTrue);
      navigatorKey.currentState!.push(MaterialPageRoute<void>(builder: (_) => const ReadAloudPage(text: 'Ein Satz. Noch ein Satz.')));
      await tester.pump(const Duration(seconds: 2));
      await tester.pump(const Duration(seconds: 2));
      expect(ScreenAwake.wanted, isTrue);
      expect(calls, isNotEmpty);
      expect(calls.every((on) => on), isTrue, reason: 'keine Szene schaltet die Sperre aus');
      navigatorKey.currentState!.pop();
      await settle(tester);
      await tester.tap(find.text('Weiter'));
      await settle(tester);
      await tester.tap(find.text('Zum Rätsel'));
      await settle(tester);
      expect(ScreenAwake.wanted, isTrue, reason: 'beim Rätseln');
      expect(calls.every((on) => on), isTrue);
    });
  });

  group('Klang im Hintergrund', () {
    test('Atmosphäre schweigt im Hintergrund, außer im Taschenmodus', () async {
      final server = FakeServer();
      final c = await newController(server, backgroundLoops: false);
      await c.start();
      final s = Soundscape(fade: const Duration(milliseconds: 20), tick: const Duration(milliseconds: 4))..attach(c);
      addTearDown(() {
        s.dispose();
        c.dispose();
      });
      final pocket = Object();
      expect(s.playing, 'wind');
      s.lifecycle(AppLifecycleState.inactive);
      expect(s.playing, 'wind', reason: 'inactive: Anruf oder Benachrichtigungen, die App ist noch zu sehen');
      s.lifecycle(AppLifecycleState.paused);
      expect(s.playing, isNull);
      s.lifecycle(AppLifecycleState.resumed);
      expect(s.playing, 'wind');
      s.keepPlaying(pocket, true);
      s.lifecycle(AppLifecycleState.paused);
      expect(s.playing, 'wind', reason: 'Taschenmodus: Ton führt weiter');
      s.release(pocket);
      expect(s.playing, isNull, reason: 'Bildschirm weg, Hintergrund: still');
      s.lifecycle(AppLifecycleState.resumed);
      expect(s.playing, 'wind');
    });
  });

  group('Verbindung zum Anstupsen', () {
    test('beim Zurückkehren in die App baut eine abgerissene Verbindung sofort neu auf, ohne ihre Pause abzuwarten', () async {
      var attempts = 0;
      final link = LiveLink(
        uri: liveUri('https://example.org/lykora', 'tok'),
        onPoke: () {},
        connect: (_) async {
          attempts++;
          throw const SocketException('kein Netz');
        },
        backoff: (_) => const Duration(minutes: 5),
      );
      link.start();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(attempts, 1);
      LiveLink.appResumed();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(attempts, 2, reason: 'sofort statt nach fünf Minuten');
      await link.stop();
      LiveLink.appResumed();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(attempts, 2, reason: 'gestoppte Verbindungen bleiben aus');
    });
  });

  group('Abgleich', () {
    test('Team verlässt das Spiel, während der Abgleich hängt: keine Fehlermeldung und kein Fehlerstand', () async {
      final server = FakeServer();
      final c = await newController(server, backgroundLoops: false);
      final logs = <String>[];
      final printer = debugPrint;
      debugPrint = (message, {wrapWidth}) => logs.add(message ?? '');
      addTearDown(() => debugPrint = printer);

      server.holdSync = Completer<void>();
      final sync = c.sync();
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(c.syncing, isTrue);
      await c.leave();
      server.holdSync!.complete();
      await sync;
      expect(logs.where((l) => l.contains('Abgleich fehlgeschlagen')), isEmpty, reason: 'früher: Null check operator used on a null value');
      expect(c.lastError, isNull);
      expect(c.hasSession, isFalse);
      expect(c.syncing, isFalse);
    });
  });
}
