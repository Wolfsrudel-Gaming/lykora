// App-Hülle: Schriftgröße, Hochformat, Lichtschalter, Zurück-Taste, Fehlerseite, Bildschirmsperre, Android-Regeln.

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/ui/design/components.dart';
import 'package:lykora/ui/design/error_view.dart';
import 'package:lykora/ui/design/text_scale.dart';
import 'package:lykora/ui/design/tokens.dart';
import 'package:lykora/ui/safety/sos_screen.dart';
import 'package:lykora/ui/screens/home_screen.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';
import 'package:lykora/ui/screens/settings_screen.dart';
import 'package:lykora/ui/widgets/common.dart';

import 'support.dart';

late FakeServer server;

/// Handy hochkant, 360 × 740 dp: eng genug, dass zu große Schrift sofort auffällt.
Future<(GameController, AppSettings)> _setup(WidgetTester tester, {bool join = true, bool started = false}) async {
  tester.view.physicalSize = const Size(1080, 2220);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  server = FakeServer();
  late GameController c;
  late AppSettings settings;
  await tester.runAsync(() async {
    final dir = await Directory.systemTemp.createTemp('lykora-shell-');
    final store = SessionStore(dir);
    c = GameController(store: store, apiFactory: (s, t) => Api(s, token: t, client: server.client()), backgroundLoops: false);
    if (join) await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
    if (started) {
      await c.start();
      await c.markIntroSeen();
    }
    settings = AppSettings(store);
  });
  return (c, settings);
}

Future<void> _settle(WidgetTester tester, [int frames = 10]) async {
  for (var i = 0; i < frames; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 15)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Seite mit Theme und der Schrift der App (System mal Regler), wie sie [LykoraApp] einstellt.
Widget _scaled(double scale, Widget home, {GameController? c, AppSettings? s}) {
  Widget app = MaterialApp(
    theme: buildTheme(const LykoraTokens(mode: LightMode.night, genre: Genre.other, young: false)),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: LykoraTextScaler(system: TextScaler.linear(scale))),
      child: child!,
    ),
    home: home,
  );
  if (c != null && s != null) app = Lykora(controller: c, settings: s, child: app);
  return app;
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

  group('Schrift', () {
    for (final scale in [1.0, 1.6, 2.0]) {
      testWidgets('Bausteine laufen bei ${(scale * 100).round()} % nicht über', (tester) async {
        await _setup(tester, join: false);
        await tester.pumpWidget(
          _scaled(
            scale,
            StageScaffold(
              title: 'Ein ziemlich langer Titel für eine Seite im Spiel',
              body: ListView(
                padding: const EdgeInsets.all(Space.gutter),
                children: [
                  const Caps('Funk · Zentrale · 21:14'),
                  const SizedBox(height: 8),
                  const Panel(child: Text('Ein Absatz in einer Fläche, der bei großer Schrift mehrere Zeilen braucht.')),
                  const SizedBox(height: 8),
                  Panel(onTap: () {}, child: const Text('Fläche zum Antippen')),
                  const SizedBox(height: 8),
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      FragmentToken(position: 1, value: '7', width: 96, big: false),
                      FragmentToken(position: 2, source: 'Bei der alten Eiche', width: 96, big: false),
                      FragmentToken(position: 3, value: '4', width: 96, big: false),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const FragmentToken(position: 4, source: 'Hinter dem Wasserturm am Waldrand'),
                  const SizedBox(height: 8),
                  const KeyRing(values: ['7', null, '4', null]),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(child: ToolKey(label: 'Tipp funken', icon: Icons.settings_input_antenna_rounded, onPressed: () {})),
                      Expanded(child: ToolKey(label: 'Szene', icon: Icons.replay_rounded, onPressed: () {})),
                      Expanded(child: ToolKey(label: 'Hakt’s?', icon: Icons.help_outline_rounded, onPressed: () {})),
                      Expanded(child: ToolKey(label: 'Einstecken', icon: Icons.phonelink_lock_rounded, onPressed: () {})),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const DisplayText('Das Echo der Wetterwarte', size: 34),
                  const SizedBox(height: 8),
                  const BeatDots(count: 4, index: 1),
                  const RewardMark(text: 'Gefunden', size: 160, animate: false),
                ],
              ),
              actions: [
                LKey(label: 'Antwort prüfen und weiter', icon: Icons.check_rounded, onPressed: () {}),
                LKey(label: 'Zurück zur Karte', kind: KeyKind.secondary, onPressed: () {}),
                LKey(label: 'Team auf diesem Handy verlassen', kind: KeyKind.tertiary, onPressed: () {}),
              ],
            ),
          ),
        );
        await _settle(tester);
        expect(tester.takeException(), isNull);
        // Die Taste wächst mit der Schrift, der Text bleibt vollständig darin.
        for (final label in ['Antwort prüfen und weiter', 'Team auf diesem Handy verlassen']) {
          final key = find.ancestor(of: find.text(label), matching: find.byType(LKey));
          final keyBox = tester.getRect(key);
          final text = tester.getRect(find.text(label));
          expect(keyBox.contains(text.topLeft) && keyBox.contains(text.bottomRight), isTrue, reason: '$label liegt ganz in der Taste ($keyBox, $text)');
          expect(keyBox.right, lessThanOrEqualTo(360));
        }
        // Drei Tasten bei 200 % lassen dem Inhalt darüber noch Platz (ohne Sicherheitsleiste, die kommt in der App dazu).
        expect(tester.getSize(find.byType(ListView)).height, greaterThanOrEqualTo(150));
      });
    }

    testWidgets('Taste mit langer Beschriftung wird bei 200 % höher als bei 100 %', (tester) async {
      await _setup(tester, join: false);
      Future<double> height(double scale) async {
        await tester.pumpWidget(
          _scaled(scale, Scaffold(body: Column(mainAxisSize: MainAxisSize.min, children: [LKey(label: 'Antwort prüfen und weiter zur nächsten Station', onPressed: () {})]))),
        );
        await _settle(tester, 2);
        return tester.getSize(find.byType(LKey)).height;
      }

      final normal = await height(1.0);
      final big = await height(2.0);
      expect(normal, greaterThanOrEqualTo(Space.primary));
      expect(big, greaterThan(normal));
      expect(tester.takeException(), isNull);
    });

    testWidgets('Hinweis (showMessage) läuft bei 200 % nicht über', (tester) async {
      await _setup(tester, join: false);
      await tester.pumpWidget(
        _scaled(
          2.0,
          Builder(
            builder: (context) => Scaffold(
              body: Center(child: LKey(label: 'Hinweis', onPressed: () => showMessage(context, 'Das Schloss klemmt kurz. Versucht es gleich nochmal.', error: true))),
            ),
          ),
        ),
      );
      await _settle(tester, 2);
      await tester.tap(find.text('Hinweis'));
      await _settle(tester, 3);
      expect(find.textContaining('Schloss klemmt'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    for (final scale in [1.0, 1.6, 2.0]) {
      testWidgets('Einstellungen bei ${(scale * 100).round()} % laufen nicht über', (tester) async {
        final (c, s) = await _setup(tester);
        await tester.pumpWidget(_scaled(scale, const SettingsScreen(), c: c, s: s));
        await _settle(tester);
        // Bis ans Ende lesen: ListView baut erst beim Scrollen.
        await tester.scrollUntilVisible(find.text('Team auf diesem Handy verlassen'), 300, scrollable: find.byType(Scrollable).first);
        await _settle(tester, 2);
        expect(tester.takeException(), isNull);
        await tester.tap(find.text('Team auf diesem Handy verlassen'));
        await _settle(tester);
        expect(find.text('Team auf diesem Handy verlassen?'), findsOneWidget);
        expect(find.text('Abbrechen'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('Die App folgt der System-Schrift und dem Regler, höchstens 200 %', (tester) async {
      final (c, s) = await _setup(tester, join: false);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      // Der Einstieg selbst läuft bei großer Schrift über (join_screen.dart); hier zählt nur der Maßstab.
      final old = FlutterError.onError;
      FlutterError.onError = (d) {
        if (!d.exceptionAsString().contains('overflowed')) old!(d);
      };
      addTearDown(() => FlutterError.onError = old);
      double scaleOf() => MediaQuery.textScalerOf(tester.element(find.byType(Navigator))).scale(10) / 10;

      tester.platformDispatcher.textScaleFactorTestValue = 1.0;
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester, 2);
      expect(scaleOf(), closeTo(1.0, 1e-9));

      tester.platformDispatcher.textScaleFactorTestValue = 1.5;
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester, 2);
      expect(scaleOf(), closeTo(1.5, 1e-9), reason: 'System-Schrift kommt an');

      s.textScale = 1.2;
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester, 2);
      expect(scaleOf(), closeTo(1.8, 1e-9), reason: 'Regler kommt obendrauf');

      s.textScale = 1.6;
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester, 2);
      expect(scaleOf(), closeTo(2.0, 1e-9), reason: 'Obergrenze 200 %');
      FlutterError.onError = old;
    });

    testWidgets('Der Regler lässt sich nicht über 200 % oder unter 90 % stellen', (tester) async {
      final (_, s) = await _setup(tester, join: false);
      await tester.runAsync(() => s.update(textScale: 5));
      expect(s.textScale, maxTextScale);
      await tester.runAsync(() => s.update(textScale: 0.1));
      expect(s.textScale, minTextScale);
    });
  });

  group('Hochformat', () {
    test('lockPortrait sperrt auf Hochformat', () async {
      final binding = TestWidgetsFlutterBinding.ensureInitialized();
      final calls = <MethodCall>[];
      binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        calls.add(call);
        return null;
      });
      addTearDown(() => binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      await lockPortrait();
      final orientation = calls.singleWhere((c) => c.method == 'SystemChrome.setPreferredOrientations');
      expect(orientation.arguments, ['DeviceOrientation.portraitUp']);
    });

    test('Android: Aktivität ist auf Hochformat gesperrt, Sicherung aus, Start dunkel', () {
      final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
      expect(manifest, contains('android:screenOrientation="portrait"'));
      expect(manifest, contains('android:allowBackup="false"'));
      expect(manifest, contains('android:dataExtractionRules="@xml/data_extraction_rules"'));
      expect(manifest, contains('android:fullBackupContent="@xml/backup_rules"'));
      // Keine Regel darf die Sitzung doch wieder einschließen.
      for (final f in ['data_extraction_rules.xml', 'backup_rules.xml']) {
        final xml = File('android/app/src/main/res/xml/$f').readAsStringSync();
        expect(xml, isNot(contains('<include')), reason: f);
        for (final domain in ['root', 'file', 'database', 'sharedpref', 'external']) {
          expect(xml, contains('<exclude domain="$domain"/>'), reason: '$f schließt $domain aus');
        }
      }
      final rules = File('android/app/src/main/res/xml/data_extraction_rules.xml').readAsStringSync();
      expect(rules, contains('<cloud-backup>'));
      expect(rules, contains('<device-transfer>'));
      for (final f in ['values/styles.xml', 'values-night/styles.xml']) {
        expect(File('android/app/src/main/res/$f').readAsStringSync(), isNot(contains('Theme.Light')), reason: '$f: kein weißer Start nachts');
      }
      expect(File('android/app/src/main/res/drawable/launch_background.xml').readAsStringSync(), isNot(contains('color/white')));
    });
  });

  group('Lichtschalter', () {
    testWidgets('wechselt Nacht, Rotlicht, Bernstein, Nacht und nie über Tag', (tester) async {
      final (_, s) = await _setup(tester, join: false);
      final seen = <LightMode>[s.lightMode];
      for (var i = 0; i < 6; i++) {
        await tester.runAsync(s.cycleLight);
        seen.add(s.lightMode);
      }
      expect(seen, [LightMode.night, LightMode.red, LightMode.amber, LightMode.night, LightMode.red, LightMode.amber, LightMode.night]);
      expect(seen, isNot(contains(LightMode.day)));
    });

    testWidgets('aus Tag geht der Schalter zurück in die Nacht', (tester) async {
      final (_, s) = await _setup(tester, join: false);
      s.lightMode = LightMode.day;
      await tester.runAsync(s.cycleLight);
      expect(s.lightMode, LightMode.night);
    });

    testWidgets('Tag nur bewusst: langes Drücken schaltet hin und zurück', (tester) async {
      final (_, s) = await _setup(tester, join: false);
      await tester.runAsync(s.toggleDay);
      expect(s.lightMode, LightMode.day);
      await tester.runAsync(s.toggleDay);
      expect(s.lightMode, LightMode.night);
      expect(AppSettings.dayHint, contains('lange drücken'));
    });

    testWidgets('der neue Modus wird für Screenreader angesagt', (tester) async {
      final (_, s) = await _setup(tester, join: false);
      final said = <String>[];
      tester.binding.defaultBinaryMessenger.setMockDecodedMessageHandler<dynamic>(SystemChannels.accessibility, (message) async {
        final data = (message as Map)['data'];
        if (data is Map && data['message'] != null) said.add(data['message'] as String);
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockDecodedMessageHandler<dynamic>(SystemChannels.accessibility, null));
      await tester.runAsync(s.cycleLight);
      expect(said, ['Licht: Rotlicht']);
      await tester.runAsync(s.cycleLight);
      expect(said.last, 'Licht: Bernstein');
    });

    testWidgets('in den Einstellungen bleibt Tag wählbar', (tester) async {
      final (c, s) = await _setup(tester);
      await tester.pumpWidget(_scaled(1.0, const SettingsScreen(), c: c, s: s));
      await _settle(tester);
      expect(find.text('Tag'), findsOneWidget);
      await tester.tap(find.text('Tag'));
      await _settle(tester);
      expect(s.lightMode, LightMode.day);
    });
  });

  group('Zurück-Taste', () {
    late List<MethodCall> platformCalls;

    setUp(() {
      platformCalls = [];
      TestWidgetsFlutterBinding.ensureInitialized().defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        platformCalls.add(call);
        return null;
      });
    });
    tearDown(() => TestWidgetsFlutterBinding.ensureInitialized().defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));

    bool exited() => platformCalls.any((c) => c.method == 'SystemNavigator.pop');

    testWidgets('im laufenden Spiel fragt die App erst und bleibt bei „Weiterspielen“', (tester) async {
      final (c, s) = await _setup(tester, started: true);
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester);
      expect(find.byType(HomeScreen), findsOneWidget);

      await tester.binding.handlePopRoute();
      await _settle(tester, 4);
      expect(find.text('App wirklich schließen?'), findsOneWidget);
      expect(find.textContaining('Euer Spielstand bleibt gespeichert'), findsOneWidget);
      expect(exited(), isFalse, reason: 'noch nicht beendet');

      await tester.tap(find.text('Weiterspielen'));
      await _settle(tester, 4);
      expect(find.text('App wirklich schließen?'), findsNothing);
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(exited(), isFalse);
    });

    testWidgets('„App schließen“ beendet die App erst nach Bestätigung', (tester) async {
      final (c, s) = await _setup(tester, started: true);
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester);
      await tester.binding.handlePopRoute();
      await _settle(tester, 4);
      await tester.tap(find.text('App schließen'));
      await _settle(tester, 4);
      expect(exited(), isTrue);
    });

    testWidgets('SOS schließt sich mit Zurück wie gewohnt, ohne Rückfrage', (tester) async {
      final (c, s) = await _setup(tester, started: true);
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester);
      navigatorKey.currentState!.push(MaterialPageRoute<void>(builder: (_) => const SosScreen()));
      await _settle(tester);
      expect(find.byType(SosScreen), findsOneWidget);

      await tester.binding.handlePopRoute();
      await _settle(tester);
      expect(find.byType(SosScreen), findsNothing);
      expect(find.text('App wirklich schließen?'), findsNothing);
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(exited(), isFalse);
    });

    testWidgets('vor dem Start fragt die App nicht', (tester) async {
      final (c, s) = await _setup(tester);
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester);
      expect(find.byType(PrepScreen), findsOneWidget);
      await tester.binding.handlePopRoute();
      await _settle(tester);
      expect(find.text('App wirklich schließen?'), findsNothing);
    });
  });

  group('Fehlerseite', () {
    late FlutterExceptionHandler? oldHandler;
    late ErrorWidgetBuilder oldBuilder;
    late bool Function(Object, StackTrace)? oldDispatcher;

    setUp(() {
      oldHandler = FlutterError.onError;
      oldBuilder = ErrorWidget.builder;
      oldDispatcher = PlatformDispatcher.instance.onError;
      ErrorLog.clear();
    });
    tearDown(() {
      FlutterError.onError = oldHandler;
      ErrorWidget.builder = oldBuilder;
      PlatformDispatcher.instance.onError = oldDispatcher;
    });

    testWidgets('kaputte Seite zeigt freundlichen Text, die Sicherheitsleiste mit SOS bleibt', (tester) async {
      final (c, s) = await _setup(tester, started: true);
      installErrorHandling();
      try {
        await tester.pumpWidget(LykoraApp(controller: c, settings: s));
        await _settle(tester);
        expect(find.text('SOS'), findsWidgets);

        navigatorKey.currentState!.push(MaterialPageRoute<void>(builder: (_) => const _Broken()));
        await _settle(tester);
        expect(tester.takeException(), isNotNull, reason: 'der Fehler wurde gemeldet');
        expect(find.text('Das Signal ist abgerissen.'), findsOneWidget);
        expect(find.textContaining('Im Notfall: 112 anrufen.'), findsOneWidget);
        expect(find.text('SOS'), findsWidgets, reason: 'Sicherheitsleiste liegt über der kaputten Seite');
        expect(ErrorLog.entries, isNotEmpty);
        expect(ErrorLog.entries.first, contains('kaputt'));
      } finally {
        // Der Test-Rahmen prüft das schon vor tearDown.
        ErrorWidget.builder = oldBuilder;
        FlutterError.onError = oldHandler;
      }
    });

    testWidgets('Fehlerseite läuft in kleinstem Platz und bei 200 % Schrift nicht über', (tester) async {
      await _setup(tester, join: false);
      for (final size in [const Size(40, 40), const Size(200, 100), const Size(360, 700)]) {
        await tester.pumpWidget(_scaled(2.0, Center(child: SizedBox.fromSize(size: size, child: const LykoraErrorView()))));
        await tester.pump();
        expect(tester.takeException(), isNull, reason: '$size');
        expect(find.text('Das Signal ist abgerissen.'), findsOneWidget);
      }
    });

    testWidgets('folgt dem Lichtmodus: bei Rotlicht kein helles Bild', (tester) async {
      await _setup(tester, join: false);
      LykoraErrorView.mode = LightMode.red;
      addTearDown(() => LykoraErrorView.mode = LightMode.night);
      await tester.pumpWidget(_scaled(1.0, const LykoraErrorView()));
      final box = tester.widget<ColoredBox>(find.descendant(of: find.byType(LykoraErrorView), matching: find.byType(ColoredBox)).first);
      expect(box.color, const Color(0xFF000000));
    });

    test('das Fehlerprotokoll behält nur die letzten Einträge', () {
      for (var i = 0; i < ErrorLog.capacity + 5; i++) {
        ErrorLog.add('Fehler $i', null);
      }
      expect(ErrorLog.entries.length, ErrorLog.capacity);
      expect(ErrorLog.entries.last, contains('Fehler ${ErrorLog.capacity + 4}'));
      expect(ErrorLog.entries.first, contains('Fehler 5'));
    });
  });

  group('Bildschirm anlassen', () {
    late List<bool> calls;

    setUp(() {
      calls = [];
      ScreenAwake.driver = (on) async => calls.add(on);
    });
    tearDown(ScreenAwake.reset);

    testWidgets('im laufenden Spiel an, mit Einstellung und Akku gesteuert', (tester) async {
      final (c, s) = await _setup(tester, started: true);
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester);
      expect(ScreenAwake.wanted, isTrue);
      expect(calls.last, isTrue);

      c.battery = 0.1;
      await tester.runAsync(() => s.update(vibration: false));
      await tester.pump();
      expect(ScreenAwake.wanted, isFalse, reason: 'unter 15 % Akku gibt die App den Bildschirm frei');
      expect(calls.last, isFalse);

      c.battery = 0.8;
      await tester.runAsync(() => s.update(vibration: true));
      await tester.pump();
      expect(ScreenAwake.wanted, isTrue);

      await tester.runAsync(() => s.update(keepAwake: false));
      await tester.pump();
      expect(ScreenAwake.wanted, isFalse, reason: 'Einstellung aus');

      await tester.pumpWidget(const SizedBox());
      expect(ScreenAwake.wanted, isFalse);
    });

    testWidgets('vor dem Start bleibt der Bildschirm unberührt', (tester) async {
      final (c, s) = await _setup(tester);
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester);
      expect(ScreenAwake.wanted, isFalse);
      expect(calls, isEmpty);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('nach einem Seitenwechsel setzt die App die Sperre wieder (Finde mich schaltet sie beim Schließen aus)', (tester) async {
      final (c, s) = await _setup(tester, started: true);
      await tester.pumpWidget(LykoraApp(controller: c, settings: s));
      await _settle(tester);
      calls.clear();
      navigatorKey.currentState!.push(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('Seite'))));
      await _settle(tester);
      navigatorKey.currentState!.pop();
      await tester.pump(const Duration(seconds: 2));
      expect(calls, contains(true));
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('Einstellung Bildschirm anlassen ist in den Einstellungen schaltbar', (tester) async {
      final (c, s) = await _setup(tester);
      await tester.pumpWidget(_scaled(1.0, const SettingsScreen(), c: c, s: s));
      await _settle(tester);
      await tester.scrollUntilVisible(find.text('Bildschirm anlassen'), 300, scrollable: find.byType(Scrollable).first);
      expect(s.keepAwake, isTrue);
      await tester.tap(find.text('Bildschirm anlassen'));
      await _settle(tester);
      expect(s.keepAwake, isFalse);
    });
  });

  group('Weniger Bewegung', () {
    Widget app(Widget home, {bool still = true}) => MaterialApp(
      theme: buildTheme(const LykoraTokens(mode: LightMode.night, genre: Genre.other, young: false)),
      builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(disableAnimations: still), child: child!),
      home: home,
    );

    testWidgets('Shake wackelt nur mit Bewegung', (tester) async {
      Future<double> shift(bool still) async {
        final controller = ShakeController();
        await tester.pumpWidget(app(Scaffold(body: Shake(controller: controller, child: const Text('Schloss'))), still: still));
        final before = tester.getTopLeft(find.text('Schloss')).dx;
        controller.shake();
        await tester.pump(const Duration(milliseconds: 25));
        return (tester.getTopLeft(find.text('Schloss')).dx - before).abs();
      }

      expect(await shift(true), 0);
      expect(await shift(false), greaterThan(0));
    });

    testWidgets('Siegel steht ohne Bewegung sofort fertig da', (tester) async {
      Future<double> opacity(bool still) async {
        await tester.pumpWidget(app(const Scaffold(body: Center(child: RewardMark(text: 'Gefunden'))), still: still));
        return tester.widget<Opacity>(find.descendant(of: find.byType(RewardMark), matching: find.byType(Opacity))).opacity;
      }

      expect(await opacity(true), 1);
      expect(await opacity(false), lessThan(1));
    });

    testWidgets('Taste und Übergang animieren nicht', (tester) async {
      await tester.pumpWidget(app(Scaffold(body: Center(child: LKey(label: 'Los', onPressed: () {})))));
      expect(tester.widget<AnimatedContainer>(find.byType(AnimatedContainer).first).duration, Duration.zero);
      await tester.pumpWidget(app(Scaffold(body: Center(child: LKey(label: 'Los', onPressed: () {}))), still: false));
      expect(tester.widget<AnimatedContainer>(find.byType(AnimatedContainer).first).duration, Motion.tick);
    });

    testWidgets('Kapitelkarte bleibt mit Screenreader länger stehen', (tester) async {
      Future<bool> stillThereAfter(Duration wait, {required bool reader}) async {
        tester.platformDispatcher.accessibilityFeaturesTestValue = FakeAccessibilityFeatures(accessibleNavigation: reader);
        addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
        await tester.pumpWidget(
          MaterialApp(
            theme: buildTheme(const LykoraTokens(mode: LightMode.night, genre: Genre.other, young: false)),
            home: Builder(builder: (context) => Scaffold(body: TextButton(onPressed: () => showChapterCard(context, label: 'Kapitel I', title: 'Der Anfang'), child: const Text('Karte')))),
          ),
        );
        await tester.tap(find.text('Karte'));
        await tester.pump(const Duration(seconds: 1));
        await tester.pump(wait);
        await tester.pump(const Duration(seconds: 1));
        return find.text('Der Anfang', skipOffstage: false).evaluate().isNotEmpty || find.text('DER ANFANG', skipOffstage: false).evaluate().isNotEmpty;
      }

      expect(await stillThereAfter(const Duration(seconds: 3), reader: false), isFalse, reason: 'ohne Screenreader nach etwa 2 s weg');
      expect(await stillThereAfter(const Duration(seconds: 3), reader: true), isTrue, reason: 'mit Screenreader noch da');
    });
  });
}

class _Broken extends StatelessWidget {
  const _Broken();

  @override
  Widget build(BuildContext context) => throw StateError('kaputt');
}
