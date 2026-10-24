// Sicherheitsoberfläche an der Datenschicht: SOS-Stand, Ortung, Sperrzonen, Rückruf, Bedienhilfen.
//
// Die Handy-Uhr steht still und rückt nur, wenn der Test es sagt; so sind Countdown und Alter genau prüfbar.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/services/fx.dart';
import 'package:lykora/ui/design/components.dart' show TapeFrame;
import 'package:lykora/ui/design/tokens.dart';
import 'package:lykora/ui/safety/emergency_screen.dart';
import 'package:lykora/ui/safety/safety_layer.dart';
import 'package:lykora/ui/safety/safety_state.dart';
import 'package:lykora/ui/safety/sos_screen.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';

import 'support.dart';

late FakeServer server;
final errors = <String>[];

/// Handy-Uhr, die nur vorrückt, wenn der Test es sagt.
class _Clock {
  int ms = DateTime.now().millisecondsSinceEpoch;
  int call() => ms;
  void advance(Duration d) => ms += d.inMilliseconds;
}

/// Ein Controller, dessen SOS-Aufruf scheitert, ohne etwas zu speichern (Ausfall in der Datenschicht).
class _BrokenSos extends GameController {
  _BrokenSos({required super.store, required super.apiFactory, required super.clock}) : super(backgroundLoops: false);

  @override
  Future<SosResult> sos({String? message}) async => throw StateError('kaputt');
}

const _phone = '+49 170 0000000';

/// Spiel im Lauf bei [width] dp Breite und Schrift [scale].
Future<(GameController, AppSettings)> _setup(
  WidgetTester tester, {
  double width = 412,
  double scale = 1.0,
  _Clock? clock,
  bool broken = false,
}) async {
  // Fehler sammeln statt abbrechen: Überläufe anderer Bildschirme (Home) gehören nicht zu diesen Tests.
  errors.clear();
  final oldHandler = FlutterError.onError;
  addTearDown(() => FlutterError.onError = oldHandler);
  FlutterError.onError = (d) {
    // Alles außer Überläufen meldet der Test wie üblich; sonst gingen auch echte Fehler lautlos unter.
    if (!d.exceptionAsString().contains('overflowed')) {
      oldHandler?.call(d);
      return;
    }
    final where = RegExp(r'(lib/[a-z_/]+\.dart:\d+)').firstMatch(d.toString())?.group(1);
    errors.add('${d.exceptionAsString().split('\n').first} @ $where');
  };
  tester.view.physicalSize = Size(width * 3, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  tester.platformDispatcher.textScaleFactorTestValue = scale;
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  server = FakeServer();
  late GameController c;
  late AppSettings settings;
  await tester.runAsync(() async {
    final dir = await Directory.systemTemp.createTemp('lykora-flow-');
    final store = SessionStore(dir);
    Api make(String s, String? t) => Api(s, token: t, client: server.client());
    c = broken
        ? _BrokenSos(store: store, apiFactory: make, clock: clock?.call)
        : GameController(store: store, apiFactory: make, backgroundLoops: false, clock: clock?.call);
    await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
    await c.start();
    await c.markIntroSeen();
    settings = AppSettings(store);
  });
  return (c, settings);
}

Future<void> _settle(WidgetTester tester, [int frames = 8]) async {
  for (var i = 0; i < frames; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 15)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Wechselt zwischen echter Ereignisschleife (Dateizugriffe) und simulierter Zeit (Animationen).
Future<void> _act(WidgetTester tester, Future<void> Function() f, {int frames = 10}) async {
  await tester.runAsync(() async {
    await f();
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
  await _settle(tester, frames);
}

Widget _wrap(GameController c, AppSettings s, Widget child) => Lykora(
  controller: c,
  settings: s,
  child: MaterialApp(theme: buildTheme(s.tokensFor(c.game)), home: child),
);

Future<void> _pumpApp(WidgetTester tester, GameController c, AppSettings s) async {
  await tester.pumpWidget(LykoraApp(controller: c, settings: s));
  await _settle(tester);
}

/// SOS auslösen, wie ein Team es tut: drei Sekunden halten.
Future<void> _holdSos(WidgetTester tester) async {
  await _reveal(tester, find.bySemanticsLabel(RegExp('SOS. Drei Sekunden')));
  final gesture = await tester.startGesture(tester.getCenter(find.bySemanticsLabel(RegExp('SOS. Drei Sekunden'))));
  await tester.pump(const Duration(milliseconds: 200));
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(seconds: 1));
  }
  await _act(tester, () async => gesture.up(), frames: 40);
}

/// Beschriftungen aller Semantics-Knoten im Baum, wie Screenreader sie vorlesen.
List<String> _labels(WidgetTester tester) => [
  for (final w in tester.widgetList<Semantics>(find.byType(Semantics)))
    if (w.properties.label != null) w.properties.label!,
];

/// Holt ein Element einer Liste ins Bild und prüft, dass man es dort antippen kann.
Future<void> _reveal(WidgetTester tester, Finder f, {Finder? scrollable}) async {
  await tester.scrollUntilVisible(f, 120, scrollable: scrollable);
  await tester.ensureVisible(f);
  await tester.pump();
  expect(f.hitTestable(), findsOneWidget, reason: 'im Bild und antippbar');
}

/// Klappt die Einzelheiten der Statusanzeige in der Leiste auf.
Future<void> _openDetails(WidgetTester tester) async {
  await tester.tap(find.descendant(of: find.byType(SafetyBar), matching: find.byType(FittedBox)).first);
  await _settle(tester);
}

Future<void> _fix(WidgetTester tester, GameController c, double lat, double lon, double acc) => _act(tester, () => c.onPosition(lat, lon, acc));

/// Uhr vorstellen und dem Controller den Takt geben, wie es die Sekundenuhr täte.
Future<void> _wait(WidgetTester tester, _Clock clock, GameController c, Duration d) async {
  // Die Sekundenuhr hat vorher getickt; sonst fehlt der Controller-Takt, der Wechsel „frisch → veraltet“ meldet.
  c.tick();
  clock.advance(d);
  c.tick();
  await _settle(tester, 2);
}

// Auf der Straße der Testspiel-Karte, vor ihr und weit draußen vor der Spielfeldgrenze.
const _onRoad = (50.8169, 7.1552);
const _nearRoad = (50.81662, 7.1552);
const _atCenter = (50.8155, 7.155);
const _outside = (50.8115, 7.155);

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

  tearDown(() {
    Fx.instance
      ..onAnnounce = null
      ..safetyCleared();
  });

  group('Leiste: Warteschlange und Ortung', () {
    testWidgets('wartender SOS, Nachricht und Aktion zählen zusammen', (tester) async {
      final handle = tester.ensureSemantics();
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      server.online = false;
      await tester.runAsync(() async {
        await c.sos(message: 'Verletzt');
        await c.sendMessage('Hallo Zentrale');
        await c.heartbeat();
      });
      expect(c.sosQueueLength, 1);
      final n = queuedCount(c);
      expect(n, c.unsyncedCount + 2, reason: 'wartende Aktionen + SOS + Nachricht');
      expect(c.unsyncedCount, greaterThanOrEqualTo(1));
      await _pumpApp(tester, c, s);
      expect(_labels(tester).where((l) => l.contains('$n Aktionen warten')), hasLength(1));
      await _openDetails(tester);
      expect(find.textContaining('$n Aktionen warten auf den Versand'), findsOneWidget);
      expect(find.textContaining('SOS ist gespeichert, letzter Versuch vor 0 s.'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('Ortung veraltet: Alter in Minuten, läuft mit der Uhr', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      await _pumpApp(tester, c, s);
      await _fix(tester, c, _atCenter.$1, _atCenter.$2, 5);
      expect(positionHint(c), isNull, reason: 'frisch');
      await _openDetails(tester);
      expect(find.textContaining('Ortung veraltet'), findsNothing);

      await _wait(tester, clock, c, const Duration(minutes: 5));
      expect(c.positionStale, isTrue);
      expect(find.textContaining('Ortung veraltet seit 5 Min.'), findsOneWidget);
      expect(find.byIcon(Icons.location_off_rounded), findsOneWidget);
      expect(_labels(tester).where((l) => l.contains('Ortung veraltet. Tippen')), hasLength(1));

      await _wait(tester, clock, c, const Duration(minutes: 2));
      expect(find.textContaining('Ortung veraltet seit 7 Min.'), findsOneWidget, reason: 'zählt ohne neuen Fix weiter');

      await _fix(tester, c, _atCenter.$1, _atCenter.$2, 5);
      expect(find.textContaining('Ortung veraltet'), findsNothing);
    });

    testWidgets('Keine Ortung: ohne Fix und bei Fehler des Ortungsdienstes', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      await _pumpApp(tester, c, s);
      expect(positionShort(c), 'Keine Ortung');
      await _openDetails(tester);
      expect(find.textContaining('Keine Ortung. Noch kein Standort empfangen.'), findsOneWidget);

      c.onPositionError('x');
      await _settle(tester);
      expect(find.textContaining('Keine Ortung. Ist der Standort eingeschaltet?'), findsOneWidget);

      await _fix(tester, c, _atCenter.$1, _atCenter.$2, 5);
      expect(find.textContaining('Keine Ortung'), findsNothing);
      c.onPositionError('wieder');
      await _settle(tester);
      expect(find.textContaining('Keine Ortung. Letzte Position von vor 0 s.'), findsOneWidget, reason: 'Fehler trotz Fix: ehrlich beides');
    });

    testWidgets('Notfallseite nennt das Alter der Position neben den Koordinaten', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      await tester.pumpWidget(_wrap(c, s, const EmergencyScreen()));
      await _settle(tester);
      expect(find.textContaining('Keine Ortung. Noch keine Position.'), findsOneWidget);

      await _fix(tester, c, _atCenter.$1, _atCenter.$2, 5);
      expect(find.text('50.81550'), findsOneWidget);
      expect(find.textContaining('Aktuell.'), findsOneWidget);
      expect(find.textContaining('veraltet'), findsNothing);

      await _wait(tester, clock, c, const Duration(minutes: 7));
      expect(find.text('50.81550'), findsOneWidget, reason: 'Koordinaten bleiben, aber mit Warnung');
      expect(find.textContaining('Position veraltet, von vor 7 Min.'), findsOneWidget);
      expect(find.textContaining('Aktuell.'), findsNothing);

      c.onPositionError('x');
      await _settle(tester);
      expect(find.textContaining('Keine Ortung. Die letzte Position ist von vor 7 Min. und kann abweichen.'), findsOneWidget);
    });
  });

  group('SOS-Seite: Stand je Alarm', () {
    testWidgets('ohne Netz: gespeichert, Countdown, Nochmal senden, dann angekommen', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      server.online = false;
      await tester.pumpWidget(_wrap(c, s, const SosScreen()));
      await _settle(tester);
      expect(find.text('Nochmal senden'), findsNothing);
      await _holdSos(tester);

      expect(find.textContaining('noch nicht gesendet'), findsOneWidget);
      expect(find.textContaining('wird nachgeholt'), findsOneWidget);
      expect(find.text('Versuch 1. Nächster Versuch in 3 s.'), findsOneWidget);
      expect(find.textContaining('Grund:'), findsOneWidget, reason: 'der Grund aus der Datenschicht');
      // Anruf und SMS sind sofort ganz vorn.
      expect(find.text('SMS jetzt senden'), findsOneWidget);
      expect(find.text('Spielleitung anrufen: $_phone'), findsOneWidget);
      expect(find.text('SOS per SMS'), findsNothing, reason: 'die SMS-Taste gibt es nur einmal, und zwar groß');
      final call = tester.getTopLeft(find.text('112 anrufen'));
      final sms = tester.getTopLeft(find.text('SMS jetzt senden'));
      expect(call.dy, lessThan(sms.dy));
      expect(sms.dy, lessThan(800), reason: 'ohne Scrollen im Bild');

      await _wait(tester, clock, c, const Duration(seconds: 2));
      expect(find.text('Versuch 1. Nächster Versuch in 1 s.'), findsOneWidget);
      await _wait(tester, clock, c, const Duration(seconds: 2));
      expect(find.text('Versuch 1. Nächster Versuch läuft gleich …'), findsOneWidget);

      // Noch kein Netz: Nochmal senden zählt einen Versuch mehr und zeigt den Stand.
      await tester.ensureVisible(find.text('Nochmal senden'));
      await tester.pump();
      await tester.tap(find.text('Nochmal senden'));
      await _settle(tester, 40);
      expect(find.textContaining('Versuch 2.'), findsOneWidget);
      expect(server.sos, isEmpty);

      server.online = true;
      await tester.ensureVisible(find.text('Nochmal senden'));
      await tester.pump();
      await tester.tap(find.text('Nochmal senden'));
      await _settle(tester, 40);
      expect(server.sos, hasLength(1));
      expect(server.sos.single['deferred'], isTrue);
      expect(find.text('Internet: Alarm ist bei der Spielleitung angekommen.'), findsOneWidget);
      expect(find.text('Nochmal senden'), findsNothing);
      expect(find.text('SMS jetzt senden'), findsNothing, reason: 'angekommen: keine Not-Taste mehr nötig');
      expect(find.text('SOS per SMS'), findsOneWidget);
    });

    testWidgets('abgelehnt: Grund, SMS groß, kein Nachholen, neuer Versuch möglich', (tester) async {
      final (c, s) = await _setup(tester);
      server.rejectSos = true;
      await tester.pumpWidget(_wrap(c, s, const SosScreen()));
      await _settle(tester);
      await _holdSos(tester);
      expect(find.textContaining('nicht gesendet. Die Spielleitung hat den Alarm nicht angenommen. kaputt'), findsOneWidget);
      expect(find.textContaining('nachgeholt'), findsNothing);
      expect(find.text('SMS jetzt senden'), findsOneWidget);
      expect(find.text('Nochmal senden'), findsNothing, reason: 'abgelehnte Alarme gehen nicht mehr raus');
      expect(c.sosRejectedCount, 1);
      expect(c.sosInfo(c.session!.lastSosId)!.phase, SosPhase.rejected);

      server.rejectSos = false;
      await tester.tap(find.text('Nochmal versuchen'));
      await _settle(tester, 40);
      expect(server.sos, hasLength(1), reason: 'neuer Alarm statt des abgelehnten');
      expect(find.text('Internet: Alarm ist bei der Spielleitung angekommen.'), findsOneWidget);
    });

    testWidgets('angekommen: keine Not-Taste, Hinweis zum Bleiben', (tester) async {
      final (c, s) = await _setup(tester);
      await tester.pumpWidget(_wrap(c, s, const SosScreen()));
      await _settle(tester);
      await _holdSos(tester);
      expect(find.text('Internet: Alarm ist bei der Spielleitung angekommen.'), findsOneWidget);
      expect(find.textContaining('Bleibt, wo ihr seid'), findsOneWidget);
      expect(find.text('SMS jetzt senden'), findsNothing);
      expect(find.text('Nochmal senden'), findsNothing);
      expect(c.sosInfo(c.session!.lastSosId)!.phase, SosPhase.delivered);
    });

    testWidgets('gescheitert (nichts gespeichert): ehrlicher Text, Anruf und SMS groß, neuer Versuch', (tester) async {
      final (c, s) = await _setup(tester, broken: true);
      await tester.pumpWidget(_wrap(c, s, const SosScreen()));
      await _settle(tester);
      await _holdSos(tester);
      expect(find.textContaining('nicht gesendet und nicht gespeichert'), findsOneWidget);
      expect(find.textContaining('Wird gesendet'), findsNothing, reason: 'die Seite hängt nie bei „Wird gesendet“');
      expect(find.textContaining('nachgeholt'), findsNothing);
      expect(find.text('SMS jetzt senden'), findsOneWidget);
      expect(find.text('Nochmal versuchen'), findsOneWidget);
    });

    testWidgets('Seite sagt, wenn die Position fehlt oder alt ist', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      await tester.pumpWidget(_wrap(c, s, const SosScreen()));
      await _settle(tester);
      expect(find.textContaining('Keine Ortung. Noch kein Standort empfangen. Sagt der Spielleitung, wo ihr seid.'), findsOneWidget);
      await _fix(tester, c, _atCenter.$1, _atCenter.$2, 5);
      expect(find.textContaining('Sagt der Spielleitung, wo ihr seid'), findsNothing);
      await _wait(tester, clock, c, const Duration(minutes: 3));
      expect(find.textContaining('Ortung veraltet seit 3 Min. Sagt der Spielleitung'), findsOneWidget);
    });

    testWidgets('Leiste sagt „angekommen“ an, wenn ein gespeicherter SOS nachgereicht wurde', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      final said = <String>[];
      Fx.instance.onAnnounce = said.add;
      await _pumpApp(tester, c, s);
      server.online = false;
      await _act(tester, () => c.sos());
      expect(find.textContaining('SOS ist gespeichert und wird weiter gesendet'), findsOneWidget);
      expect(said, isEmpty);
      server.online = true;
      await _act(tester, () => c.flushSos(force: true), frames: 30);
      expect(c.sosPending, isFalse);
      expect(said, ['SOS ist bei der Spielleitung angekommen.']);
      expect(find.textContaining('SOS ist gespeichert'), findsNothing);
    });

    testWidgets('Leiste zeigt abgelehnten SOS und sagt es an', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      final said = <String>[];
      Fx.instance.onAnnounce = said.add;
      await _pumpApp(tester, c, s);
      server.rejectSos = true;
      await _act(tester, () => c.sos(), frames: 30);
      expect(c.sosRejectedCount, 1);
      expect(find.textContaining('Euer SOS wurde nicht angenommen'), findsOneWidget);
      expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);
      expect(said, ['SOS nicht angenommen. Ruft die Spielleitung an oder schickt eine SMS.']);
    });
  });

  group('Sperrzonen: Vollbild, Streifen, Ortung ungenau', () {
    testWidgets('Vollbild nur bei sicherer Ortung, ohne Flackern bei weiteren Fixes', (tester) async {
      final (c, s) = await _setup(tester, clock: _Clock());
      await _pumpApp(tester, c, s);
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      expect(find.text('ECHT – KEIN SPIEL'), findsNothing, reason: 'ein Fix reicht nicht');
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      expect(find.textContaining('Ihr seid in der Sperrzone „Straße“.'), findsOneWidget);
      expect(find.text('ECHT – KEIN SPIEL'), findsOneWidget);
      final panel = tester.element(find.byKey(const ValueKey('zone-strasse')));
      for (var i = 0; i < 3; i++) {
        await _fix(tester, c, _onRoad.$1 + 0.000005 * i, _onRoad.$2, 5);
        expect(find.byKey(const ValueKey('zone-strasse')), findsOneWidget);
        expect(identical(tester.element(find.byKey(const ValueKey('zone-strasse'))), panel), isTrue, reason: 'dieselbe Seite, kein Neuaufbau');
      }
    });

    testWidgets('Ortung ungenau: ruhiger Hinweis, nie Vollbild, kein Alarm', (tester) async {
      final (c, s) = await _setup(tester, clock: _Clock());
      final buzzes = <Buzz>[];
      Fx.instance.onBuzz = buzzes.add;
      addTearDown(() => Fx.instance.onBuzz = null);
      await _pumpApp(tester, c, s);
      for (var i = 0; i < 4; i++) {
        await _fix(tester, c, _onRoad.$1, _onRoad.$2, 80);
      }
      expect(c.zoneAlert!.uncertain, isTrue);
      expect(find.textContaining('Ortung ungenau (±80 m)'), findsOneWidget);
      expect(find.text('ECHT – KEIN SPIEL'), findsNothing);
      expect(find.textContaining('Ihr seid in der Sperrzone'), findsNothing);
      expect(find.textContaining('ECHT ·'), findsNothing, reason: 'kein lauter Streifen');
      // Höchstens der kurze Hinweis „Zone nah“, nie der Alarm für „drin“ (der setzt safetyActive).
      expect(buzzes.where((b) => b == Buzz.safety).length, lessThanOrEqualTo(1));
      expect(Fx.instance.safetyActive, isFalse);
    });

    testWidgets('Spielfeldgrenze: eigener Text mit Weg zum Sammelpunkt', (tester) async {
      final (c, s) = await _setup(tester, clock: _Clock());
      await _pumpApp(tester, c, s);
      await _fix(tester, c, _outside.$1, _outside.$2, 5);
      expect(find.textContaining('Ihr verlasst das Spielfeld'), findsNothing, reason: 'ein Fix reicht nicht');
      await _fix(tester, c, _outside.$1, _outside.$2, 5);
      expect(c.zoneAlert!.boundary, isTrue);
      expect(find.textContaining(RegExp(r'Ihr verlasst das Spielfeld\. Umkehren\. Sammelpunkt: \d+ m\.')), findsOneWidget);
      expect(find.text('ECHT – KEIN SPIEL'), findsNothing, reason: 'Grenze ist Stufe B');
      expect(find.byIcon(Icons.arrow_back_rounded), findsNothing);
    });

    testWidgets('Warnung vor der Zone ist Stufe B und sagt, wenn die Ortung alt ist', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      await _pumpApp(tester, c, s);
      await _fix(tester, c, _nearRoad.$1, _nearRoad.$2, 5);
      expect(find.textContaining('Achtung: Straße in'), findsOneWidget);
      expect(find.textContaining('Ortung veraltet.'), findsNothing);
      await _wait(tester, clock, c, const Duration(seconds: 40));
      expect(find.textContaining('Achtung: Straße in'), findsOneWidget);
      expect(find.textContaining('Ortung veraltet.'), findsOneWidget);
    });

    testWidgets('„Meine Position stimmt nicht“: Vollbild weicht für eine Minute, Streifen und SOS bleiben', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      await _pumpApp(tester, c, s);
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      expect(find.text('ECHT – KEIN SPIEL'), findsOneWidget);
      expect(Fx.instance.safetyActive, isTrue);

      await _act(tester, () async => tester.tap(find.text('Meine Position stimmt nicht')));
      expect(find.text('ECHT – KEIN SPIEL'), findsNothing);
      expect(find.textContaining('Ihr seid in der Sperrzone „Straße“'), findsOneWidget, reason: 'als Streifen sichtbar');
      expect(find.text('SOS'), findsOneWidget);
      expect(server.messages.single['body'], contains('Position stimmt nicht'));
      expect(server.messages.single['body'], contains('Straße'));
      expect(Fx.instance.safetyActive, isFalse, reason: 'die Atmosphäre darf zurück');

      // Weitere Fixes in der Zone bringen das Vollbild nicht zurück.
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      expect(find.text('ECHT – KEIN SPIEL'), findsNothing);

      clock.advance(const Duration(seconds: 61));
      await tester.pump(const Duration(seconds: 61));
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      expect(find.text('ECHT – KEIN SPIEL'), findsOneWidget, reason: 'nach der Minute gilt das Vollbild wieder');
    });

    testWidgets('Verlassen der Zone: „Danke“ für drei Sekunden, dann ist die Atmosphäre wieder frei', (tester) async {
      final (c, s) = await _setup(tester, clock: _Clock());
      await _pumpApp(tester, c, s);
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      expect(Fx.instance.safetyActive, isTrue);
      await _fix(tester, c, _atCenter.$1, _atCenter.$2, 5);
      expect(find.text('Danke, ihr seid wieder sicher.'), findsOneWidget);
      expect(Fx.instance.safetyActive, isTrue, reason: 'während „Danke“ bleibt es still');
      // Der Takt von drei Sekunden läuft in echter Zeit, weil der Fix in runAsync einging.
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 3300)));
      await tester.pump();
      expect(find.text('Danke, ihr seid wieder sicher.'), findsNothing);
      expect(Fx.instance.safetyActive, isFalse);
    });
  });

  group('Rückruf und Lebenszeichen: Verbindung zur Spielleitung', () {
    testWidgets('Rückruf: Alter der Verbindung, nach 15 Minuten die Nummer groß', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      await _pumpApp(tester, c, s);
      server.status = 'recalled';
      await _act(tester, () => c.sync());
      expect(find.text('ALLE ZURÜCK ZUM SAMMELPUNKT'), findsOneWidget);
      expect(find.text('Zuletzt Verbindung gerade eben.'), findsOneWidget);
      expect(find.textContaining('Spielleitung anrufen'), findsNothing);

      server.online = false;
      await _wait(tester, clock, c, const Duration(minutes: 12));
      expect(find.text('Zuletzt Verbindung vor 12 Min.'), findsOneWidget);
      expect(find.textContaining('Spielleitung anrufen'), findsNothing);
      expect(find.textContaining('keine Verbindung zur Spielleitung'), findsNothing, reason: 'unter 15 Minuten kein Streifen');

      await _wait(tester, clock, c, const Duration(minutes: 4));
      expect(find.text('Zuletzt Verbindung vor 16 Min.'), findsOneWidget);
      expect(find.text('Spielleitung anrufen: $_phone'), findsOneWidget, reason: 'genau einmal, auch mit Streifen darüber');
      expect(find.textContaining('Seit 16 Min. keine Verbindung'), findsNothing, reason: 'das Vollbild sagt es schon');
    });

    testWidgets('Lebenszeichen: Verbindungsalter in der Frage, Nummer ab 15 Minuten', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      await _pumpApp(tester, c, s);
      await _act(tester, () => c.sync());
      server.online = false;
      final interval = Duration(seconds: c.game!.safety.heartbeatInterval);
      await _wait(tester, clock, c, interval + const Duration(seconds: 30));
      expect(c.heartbeatDue, isTrue);
      expect(find.text('Ja, alles okay'), findsOneWidget);
      expect(find.text('Zuletzt Verbindung vor 15 Min.'), findsOneWidget);
      expect(find.text('Spielleitung anrufen: $_phone'), findsOneWidget, reason: 'seit 15 Min. ohne Verbindung');

      server.online = true;
      await _act(tester, () => c.sync());
      expect(find.text('Spielleitung anrufen: $_phone'), findsNothing, reason: 'Verbindung steht wieder');
    });

    testWidgets('ohne Frage: Streifen mit Nummer erst nach 15 Minuten ohne Verbindung', (tester) async {
      final clock = _Clock();
      final (c, s) = await _setup(tester, clock: clock);
      await _pumpApp(tester, c, s);
      await _act(tester, () => c.sync());
      server.online = false;
      await _wait(tester, clock, c, const Duration(minutes: 14));
      await _act(tester, () => c.heartbeat());
      expect(c.heartbeatDue, isFalse);
      expect(find.textContaining('keine Verbindung zur Spielleitung'), findsNothing);
      await _wait(tester, clock, c, const Duration(minutes: 2));
      expect(find.textContaining('Seit 16 Min. keine Verbindung zur Spielleitung'), findsOneWidget);
      expect(find.text('Spielleitung anrufen: $_phone'), findsOneWidget);
      // Die Leiste nennt das Alter auch in den Einzelheiten.
      await _openDetails(tester);
      expect(find.text('Zuletzt Verbindung vor 16 Min.'), findsOneWidget);
    });
  });

  group('Lichtschalter', () {
    testWidgets('langes Drücken schaltet Tag ein und zurück, mit Hinweis; Beschriftung ≥ 15', (tester) async {
      final (c, s) = await _setup(tester, clock: _Clock());
      await _pumpApp(tester, c, s);
      final label = tester.widget<Text>(find.descendant(of: find.byType(SafetyBar), matching: find.text(s.lightMode.label)));
      expect(label.style!.fontSize, greaterThanOrEqualTo(15));

      await tester.longPress(find.byIcon(Icons.nightlight_round));
      await _settle(tester);
      expect(s.lightMode, LightMode.day);
      expect(find.text(AppSettings.dayHint), findsOneWidget);
      final hint = tester.widget<Text>(find.text(AppSettings.dayHint));
      expect(hint.style!.fontSize, greaterThanOrEqualTo(15));

      await tester.longPress(find.byIcon(Icons.wb_sunny_rounded));
      await _settle(tester);
      expect(s.lightMode, LightMode.night);
    });

    testWidgets('kurzes Tippen wechselt ohne Tag und ohne Hinweis', (tester) async {
      final (c, s) = await _setup(tester, clock: _Clock());
      await _pumpApp(tester, c, s);
      await tester.tap(find.byIcon(Icons.nightlight_round));
      await _settle(tester);
      expect(s.lightMode, LightMode.red);
      expect(find.text(AppSettings.dayHint), findsNothing);
    });

    testWidgets('Screenreader: Tippen und langes Drücken sind als Aktionen da', (tester) async {
      final handle = tester.ensureSemantics();
      final (c, s) = await _setup(tester, clock: _Clock());
      await _pumpApp(tester, c, s);
      final light = find.semantics.byLabel(RegExp('Licht: .* lange drücken für Tag'));
      expect(light, findsOneWidget);
      tester.semantics.longPress(light);
      await _settle(tester);
      expect(s.lightMode, LightMode.day);
      tester.semantics.tap(find.semantics.byLabel(RegExp('Licht: .* lange drücken für Nacht')));
      await _settle(tester);
      expect(s.lightMode, LightMode.night, reason: 'aus Tag geht ein Tipp zurück in die Nacht');
      handle.dispose();
    });
  });

  group('Bedienhilfen', () {
    testWidgets('SOS-Taste der Leiste ist per Screenreader auslösbar', (tester) async {
      final handle = tester.ensureSemantics();
      final (c, s) = await _setup(tester, clock: _Clock());
      await _pumpApp(tester, c, s);
      tester.semantics.tap(find.semantics.byLabel('SOS – Notruf öffnen'));
      await _settle(tester);
      expect(find.byType(SosScreen), findsOneWidget);
      handle.dispose();
    });

    testWidgets('SOS auslösen als Aktion: erst Bestätigung, Abbrechen löst nichts aus', (tester) async {
      final handle = tester.ensureSemantics();
      final (c, s) = await _setup(tester, clock: _Clock());
      await tester.pumpWidget(_wrap(c, s, const SosScreen()));
      await _settle(tester);
      final hold = find.semantics.byLabel(RegExp('SOS. Drei Sekunden'));
      final node = tester.getSemantics(find.bySemanticsLabel(RegExp('SOS. Drei Sekunden')));
      final data = node.getSemanticsData();
      expect(data.customSemanticsActionIds, isNotNull);
      final labels = [for (final id in data.customSemanticsActionIds!) CustomSemanticsAction.getAction(id)!.label];
      expect(labels, contains('SOS auslösen'));
      expect(data.hasAction(SemanticsAction.longPress), isTrue);
      expect(data.hasAction(SemanticsAction.tap), isTrue);

      tester.semantics.performAction(
        hold,
        SemanticsAction.customAction,
        args: CustomSemanticsAction.getIdentifier(const CustomSemanticsAction(label: 'SOS auslösen')),
      );
      await _settle(tester);
      expect(find.text('SOS wirklich auslösen?'), findsOneWidget);
      expect(server.sos, isEmpty, reason: 'noch nichts gesendet');
      await tester.tap(find.text('Abbrechen'));
      await _settle(tester);
      expect(find.text('SOS wirklich auslösen?'), findsNothing);
      expect(find.text('SOS – 3 Sekunden halten'), findsOneWidget);
      expect(server.sos, isEmpty);

      tester.semantics.longPress(hold);
      await _settle(tester);
      expect(find.text('SOS wirklich auslösen?'), findsOneWidget, reason: 'langes Drücken per Bedienhilfe führt zur selben Bestätigung');
      await tester.tap(find.text('Ja, SOS senden'));
      await _settle(tester, 40);
      expect(server.sos, hasLength(1));
      expect(find.text('Internet: Alarm ist bei der Spielleitung angekommen.'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('mit Bedienhilfe steht eine sichtbare Taste ohne Halten da', (tester) async {
      final (c, s) = await _setup(tester, clock: _Clock());
      await tester.pumpWidget(_wrap(c, s, const SosScreen()));
      await _settle(tester);
      expect(find.text('SOS auslösen (ohne Halten)'), findsNothing);
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(accessibleNavigation: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await _settle(tester);
      expect(find.text('SOS auslösen (ohne Halten)'), findsOneWidget);
      await tester.tap(find.text('SOS auslösen (ohne Halten)'));
      await _settle(tester);
      expect(find.text('SOS wirklich auslösen?'), findsOneWidget);
    });

    testWidgets('Stand des Alarms ist ein Live-Bereich, der Countdown nicht', (tester) async {
      final handle = tester.ensureSemantics();
      final (c, s) = await _setup(tester, clock: _Clock());
      server.online = false;
      await tester.pumpWidget(_wrap(c, s, const SosScreen()));
      await _settle(tester);
      await _holdSos(tester);
      bool live(Finder f) => tester.getSemantics(f).getSemanticsData().flagsCollection.isLiveRegion;
      expect(live(find.textContaining('noch nicht gesendet')), isTrue);
      expect(live(find.textContaining('Schickt jetzt eine SMS')), isTrue);
      expect(live(find.textContaining('Nächster Versuch in')), isFalse, reason: 'Sekunden würden sonst jede Sekunde vorgelesen');
      handle.dispose();
    });

    testWidgets('Streifen und Vollbild sind Live-Bereiche', (tester) async {
      final handle = tester.ensureSemantics();
      final (c, s) = await _setup(tester, clock: _Clock());
      await _pumpApp(tester, c, s);
      await _fix(tester, c, _nearRoad.$1, _nearRoad.$2, 5);
      bool live(Finder f) => tester.getSemantics(f).getSemanticsData().flagsCollection.isLiveRegion;
      expect(live(find.textContaining('Achtung: Straße in')), isTrue);
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
      expect(live(find.textContaining('Ihr seid in der Sperrzone „Straße“.')), isTrue);
      handle.dispose();
    });
  });

  group('Layout in jeder Enge', () {
    for (final width in [320.0, 360.0, 412.0]) {
      for (final scale in [1.0, 1.6, 2.0]) {
        final tag = 'Breite $width, Schrift $scale';

        testWidgets('SOS-Seite gespeichert und abgelehnt: $tag', (tester) async {
          final (c, s) = await _setup(tester, width: width, scale: scale, clock: _Clock());
          server.online = false;
          await tester.pumpWidget(_wrap(c, s, const SosScreen()));
          await _settle(tester);
          await _holdSos(tester);
          expect(find.textContaining('noch nicht gesendet'), findsOneWidget);
          await _reveal(tester, find.text('SMS jetzt senden'));
          await _reveal(tester, find.text('Nochmal senden'));
          expect(errors.where((e) => e.contains('ui/safety/')), isEmpty);
        });

        testWidgets('SOS-Seite abgelehnt: $tag', (tester) async {
          final (c, s) = await _setup(tester, width: width, scale: scale, clock: _Clock());
          server.rejectSos = true;
          await tester.pumpWidget(_wrap(c, s, const SosScreen()));
          await _settle(tester);
          await _holdSos(tester);
          expect(find.textContaining('nicht angenommen'), findsOneWidget);
          await _reveal(tester, find.text('SMS jetzt senden'));
          await _reveal(tester, find.text('Nochmal versuchen'));
          expect(errors.where((e) => e.contains('ui/safety/')), isEmpty);
        });

        testWidgets('Sperrzone, Rückruf und Streifen: $tag', (tester) async {
          final clock = _Clock();
          final (c, s) = await _setup(tester, width: width, scale: scale, clock: clock);
          await _pumpApp(tester, c, s);
          // Streifen: Ortung ungenau, dann Warnung, dann Vollbild.
          await _fix(tester, c, _onRoad.$1, _onRoad.$2, 80);
          expect(find.textContaining('Ortung ungenau'), findsOneWidget);
          await _fix(tester, c, _nearRoad.$1, _nearRoad.$2, 5);
          expect(find.textContaining('Achtung: Straße in'), findsOneWidget);
          await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
          await _fix(tester, c, _onRoad.$1, _onRoad.$2, 5);
          expect(find.text('ECHT – KEIN SPIEL'), findsOneWidget);
          await _reveal(
            tester,
            find.text('Meine Position stimmt nicht'),
            scrollable: find.descendant(of: find.byType(TapeFrame), matching: find.byType(Scrollable)),
          );
          expect(find.text('SOS').hitTestable(), findsOneWidget, reason: 'SOS bleibt oben im Bild');
          await _fix(tester, c, _atCenter.$1, _atCenter.$2, 5);
          await tester.pump(const Duration(seconds: 4));

          // Rückruf nach langer Funkstille.
          server.status = 'recalled';
          await _act(tester, () => c.sync());
          server.online = false;
          await _wait(tester, clock, c, const Duration(minutes: 20));
          expect(find.text('ALLE ZURÜCK ZUM SAMMELPUNKT'), findsOneWidget);
          await _reveal(
            tester,
            find.text('Spielleitung anrufen: $_phone'),
            scrollable: find.descendant(of: find.byType(TapeFrame), matching: find.byType(Scrollable)),
          );
          expect(find.text('SOS').hitTestable(), findsOneWidget);
          expect(errors.where((e) => e.contains('ui/safety/')), isEmpty, reason: errors.join('\n'));
        });

        testWidgets('Lebenszeichen mit Nummer, Leiste mit Einzelheiten: $tag', (tester) async {
          final clock = _Clock();
          final (c, s) = await _setup(tester, width: width, scale: scale, clock: clock);
          await _pumpApp(tester, c, s);
          await _act(tester, () => c.sync());
          server.online = false;
          c.battery = 0.12;
          await _wait(tester, clock, c, Duration(seconds: c.game!.safety.heartbeatInterval) + const Duration(minutes: 1));
          expect(find.text('Ja, alles okay'), findsOneWidget);
          await _openDetails(tester);
          expect(find.textContaining('Zuletzt Verbindung vor'), findsWidgets);
          final sos = tester.getRect(find.text('SOS').first);
          expect(sos.right, lessThanOrEqualTo(width));
          expect(errors.where((e) => e.contains('ui/safety/')), isEmpty, reason: errors.join('\n'));
        });
      }
    }
  });
}
