// Gemeinsame Helfer für die Tests der Spielschleife: Ortung ohne Plugin, Spielrahmen mit steuerbarer Uhr, Messung von Neuaufbauten.

import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart' show FlutterExceptionHandler;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart' show Position;
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/services/fx.dart';
import 'package:lykora/services/location.dart';

import 'support.dart';

/// Ortung ohne Plugin: merkt sich, was die App von ihr will.
class FakeLocation extends LocationService {
  int starts = 0;
  int restarts = 0;
  int checks = 0;
  LocationState state = LocationState.ready;
  void Function(Position p)? onPosition;
  void Function(Object error)? onError;
  bool _running = false;

  @override
  bool get running => _running;

  @override
  Future<String?> ensurePermission() async => LocationService.problemText(state);

  @override
  Future<LocationState> check() async {
    checks++;
    return state;
  }

  @override
  Future<void> start(void Function(Position p) onPosition, {void Function(Object error)? onError}) async {
    if (_running) return;
    starts++;
    _running = true;
    this.onPosition = onPosition;
    this.onError = onError;
  }

  @override
  Future<void> restart(void Function(Position p) onPosition, {void Function(Object error)? onError}) async {
    restarts++;
    _running = true;
    this.onPosition = onPosition;
    this.onError = onError;
  }

  @override
  Future<void> stop() async => _running = false;
}

/// Steuerung, die mitzählt, wie oft die App aus dem Hintergrund zurückkam.
class SpyController extends GameController {
  SpyController({required super.store, super.apiFactory, super.clock, super.backgroundLoops});
  int resumed = 0;

  @override
  void onAppResumed() {
    resumed++;
    super.onAppResumed();
  }
}

/// Spiel mit einer Aufgabe „Ortet euch“ statt der Wahlfrage im Briefing.
Map<String, dynamic> gameWithFindLocation() {
  final g = jsonDecode(jsonEncode(gameJson)) as Map<String, dynamic>;
  final briefing = (g['stations'] as List).cast<Map<String, dynamic>>().firstWhere((s) => s['id'] == 'briefing');
  briefing['task'] = {
    'type': 'find_location',
    'question': {'de': 'Stellt euch an die Bank am Brunnen.'},
    'prompt': {'de': 'Stellt euch an die Bank am Brunnen.'},
    'location': {'lat': 50.8156, 'lon': 7.1552},
    'radius': 30,
  };
  return g;
}

class Rig {
  Rig(this.c, this.settings, this.server, this.location, this.clock);
  final SpyController c;
  final AppSettings settings;
  final FakeServer server;
  final FakeLocation location;
  final TestClock clock;
}

class TestClock {
  TestClock() : ms = DateTime.now().millisecondsSinceEpoch;
  int ms;
  void advance(Duration d) => ms += d.inMilliseconds;
}

/// Handy hochkant mit [width] dp Breite, Spiel läuft, Einführung gesehen.
Future<Rig> rig(WidgetTester tester, {double width = 412, Map<String, dynamic>? game, bool started = true, bool hasLoops = false}) async {
  tester.view.physicalSize = Size(width * 3, 2745);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final clock = TestClock();
  final server = FakeServer(game: game, now: () => DateTime.fromMillisecondsSinceEpoch(clock.ms));
  late SpyController c;
  late AppSettings settings;
  await tester.runAsync(() async {
    final dir = await Directory.systemTemp.createTemp('lykora-loop-');
    final store = SessionStore(dir);
    c = SpyController(
      store: store,
      apiFactory: (s, t) => Api(s, token: t, client: server.client()),
      clock: () => clock.ms,
      backgroundLoops: hasLoops,
    );
    await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
    if (started) {
      await c.start();
      await c.markIntroSeen();
    }
    settings = AppSettings(store);
  });
  final location = FakeLocation();
  final before = LocationService.instance;
  LocationService.instance = location;
  addTearDown(() => LocationService.instance = before);
  addTearDown(() {
    Fx.instance.onBuzz = null;
    Fx.instance.onPlay = null;
  });
  return Rig(c, settings, server, location, clock);
}

Widget app(Rig r) => LykoraApp(controller: r.c, settings: r.settings);

/// Feste Zahl von Bildern; wechselt zwischen echter Ereignisschleife (Dateizugriffe) und simulierter Zeit.
Future<void> settle(WidgetTester tester, [int frames = 10]) async {
  for (var i = 0; i < frames; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 15)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> act(WidgetTester tester, Future<void> Function() f) async {
  await tester.runAsync(() async {
    await f();
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
  await settle(tester);
}

/// Simulierte Sekunden ohne Dateizugriffe.
Future<void> elapse(WidgetTester tester, int seconds) async {
  for (var i = 0; i < seconds; i++) {
    await tester.pump(const Duration(seconds: 1));
  }
}

/// Sammelt Layoutfehler samt Fundstelle, damit der Test sagt, welches Widget überläuft.
class ErrorProbe {
  ErrorProbe() : _old = FlutterError.onError {
    FlutterError.onError = (d) {
      final text = d.toDiagnosticsNode().toStringDeep();
      final where = RegExp(r'(\w+\.dart:\d+:\d+)').firstMatch(text)?.group(1) ?? '?';
      _errors.add('${d.exceptionAsString()} bei $where');
    };
  }
  final FlutterExceptionHandler? _old;
  final _errors = <String>[];

  void restore() => FlutterError.onError = _old;

  /// Schlägt fehl (mit Fundstelle), wenn seit dem letzten Aufruf ein Fehler kam.
  void check(String reason) {
    if (_errors.isEmpty) return;
    final found = _errors.toSet().join('; ');
    _errors.clear();
    restore();
    fail('$reason: $found');
  }
}

Finder textI(String text) => find.byWidgetPredicate((w) => w is Text && (w.data ?? '').toLowerCase() == text.toLowerCase());
Finder textContainsI(String text) => find.byWidgetPredicate((w) => w is Text && (w.data ?? '').toLowerCase().contains(text.toLowerCase()));

/// Station baum: 50.816, 7.1565, Auslöseradius 25 m. „meters“ Meter nördlich davon.
Future<void> fixNearBaum(Rig r, double meters, {DateTime? at, double accuracy = 5}) => r.c.onPosition(50.816 + meters / 111320, 7.1565, accuracy, at: at);

/// Irgendwo weit weg von allen Stationen und Zonen.
Future<void> fixFar(Rig r, {DateTime? at}) => r.c.onPosition(50.8185, 7.1500, 5, at: at);
