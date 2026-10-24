// Gemeinsame Helfer für die Oberflächentests von Einstieg und Vorbereitung: Handygröße, Ersatz für Ortung und Berechtigungen.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart' show Position;
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/services/location.dart';
import 'package:lykora/services/permissions.dart';
import 'package:lykora/ui/design/text_scale.dart';
import 'package:lykora/ui/design/tokens.dart';

import 'support.dart';

const address = 'https://example.org/lykora';

/// Controller, der zählt, wie oft die App in den Vordergrund kam.
class SpyController extends GameController {
  SpyController({required super.store, super.apiFactory, super.clock, super.backgroundLoops});
  int resumed = 0;

  @override
  void onAppResumed() {
    resumed++;
    super.onAppResumed();
  }
}

/// Ortung ohne Plugin: Zustand und Antwort auf die Frage nach der Erlaubnis stellt der Test.
class FakeLocation extends LocationService {
  LocationState state = LocationState.denied;

  /// Antwort auf [request]; null lässt [state] unverändert
  LocationState? afterRequest;
  int checks = 0, requests = 0, starts = 0, restarts = 0, stops = 0, appSettings = 0, locationSettings = 0;
  void Function(Object error)? lastOnError;
  bool _running = false;

  @override
  bool get running => _running;

  @override
  Future<LocationState> check() async {
    checks++;
    return state;
  }

  @override
  Future<LocationState> request() async {
    requests++;
    if (afterRequest != null) state = afterRequest!;
    return state;
  }

  @override
  Future<void> start(void Function(Position p) onPosition, {void Function(Object error)? onError}) async {
    if (_running) return;
    starts++;
    lastOnError = onError;
    _running = true;
  }

  @override
  Future<void> restart(void Function(Position p) onPosition, {void Function(Object error)? onError}) async {
    restarts++;
    lastOnError = onError;
    _running = true;
  }

  @override
  Future<void> stop() async {
    stops++;
    _running = false;
  }

  @override
  Future<void> openSettings() async => appSettings++;

  @override
  Future<void> openLocationSettings() async => locationSettings++;
}

/// Berechtigungen ohne Plugin.
class FakePermissions extends DevicePermissions {
  PermStatus notification = PermStatus.denied;
  PermStatus batteryStatus = PermStatus.denied;
  PermStatus cameraStatus = PermStatus.denied;

  /// Antwort des Systems auf eine Frage: erlaubt
  bool grantOnAsk = true;
  final asked = <String>[];
  int settings = 0;

  PermStatus _ask(String name, PermStatus current, bool ask) {
    if (!ask) return current;
    asked.add(name);
    return grantOnAsk ? PermStatus.granted : current;
  }

  @override
  Future<PermStatus> notifications({bool ask = false}) async => notification = _ask('notifications', notification, ask);

  @override
  Future<PermStatus> battery({bool ask = false}) async => batteryStatus = _ask('battery', batteryStatus, ask);

  @override
  Future<PermStatus> camera({bool ask = false}) async => cameraStatus = _ask('camera', cameraStatus, ask);

  @override
  Future<void> openSettings() async => settings++;
}

/// Handy hochkant mit der gegebenen Breite in dp (Pixeldichte 1).
void phone(WidgetTester tester, {double width = 360, double height = 740}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// Ordner, Server und Controller. Mit [join] ist das Team beigetreten (Medien warten auf Wunsch im Hintergrund).
Future<(SpyController, AppSettings, FakeServer)> game(
  WidgetTester tester, {
  bool join = true,
  bool awaitMedia = true,
  FakeServer? server,
  Duration? timeout,
  int Function()? clock,
}) async {
  final s = server ?? FakeServer();
  late SpyController c;
  late AppSettings settings;
  await tester.runAsync(() async {
    final dir = await Directory.systemTemp.createTemp('lykora-uitest-');
    final store = SessionStore(dir);
    c = SpyController(
      store: store,
      apiFactory: (a, t) => timeout == null ? Api(a, token: t, client: s.client()) : Api(a, token: t, client: s.client(), connectTimeout: timeout, idleTimeout: timeout),
      clock: clock,
      backgroundLoops: false,
    );
    if (join) await c.join(server: address, code: 'K7M2QX', teamName: 'Füchse', awaitMedia: awaitMedia);
    settings = AppSettings(store);
  });
  return (c, settings, s);
}

/// Die Schrift der App (System mal Regler), wie [LykoraApp] sie einstellt.
Widget scaled(double scale, Widget home, {GameController? c, AppSettings? s}) {
  Widget app = MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: buildTheme(s == null ? const LykoraTokens(mode: LightMode.night, genre: Genre.other, young: false) : s.tokensFor(c?.game)),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: LykoraTextScaler(system: TextScaler.linear(scale))),
      child: child!,
    ),
    home: home,
  );
  if (c != null && s != null) app = Lykora(controller: c, settings: s, child: app);
  return app;
}

/// Feste Zahl von Frames statt pumpAndSettle: Laterne und Peiler atmen ständig.
Future<void> settle(WidgetTester tester, [int frames = 10]) async {
  for (var i = 0; i < frames; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 15)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Führt [f] mit echter Ereignisschleife aus (Dateien, Netz des Nachbaus) und lässt die Oberfläche danach nachziehen.
Future<void> act(WidgetTester tester, Future<void> Function() f, {int real = 300}) async {
  await tester.runAsync(() async {
    await f();
    await Future<void>.delayed(Duration(milliseconds: real));
  });
  await settle(tester);
}

/// Meldet die App-Ereignisse App-Links nicht vorhanden: JoinScreen hört darauf.
void mockAppLinks() {
  TestWidgetsFlutterBinding.ensureInitialized().defaultBinaryMessenger.setMockStreamHandler(
    const EventChannel('com.llfbandit.app_links/events'),
    MockStreamHandler.inline(onListen: (_, _) {}),
  );
}

/// Ersatz für Ortung und Berechtigungen einsetzen; nach dem Test zurück zum Echten.
(FakeLocation, FakePermissions) fakeDevice() {
  final oldLocation = LocationService.instance;
  final oldPerms = DevicePermissions.instance;
  final loc = FakeLocation();
  final perms = FakePermissions();
  LocationService.instance = loc;
  DevicePermissions.instance = perms;
  addTearDown(() {
    LocationService.instance = oldLocation;
    DevicePermissions.instance = oldPerms;
  });
  return (loc, perms);
}

/// Blättert die erste Liste der Seite, bis [finder] ganz zu sehen ist (die Seiten haben mehrere Scrollables, etwa Textfelder).
Future<void> reveal(WidgetTester tester, Finder finder, [double delta = 150]) async {
  await tester.scrollUntilVisible(finder, delta, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(finder);
  await tester.pump();
}

/// Text ohne Rücksicht auf Groß- und Kleinschreibung: Titel der Spielwelt erscheinen oft in Versalien.
Finder textCI(String text) => find.byWidgetPredicate((w) => w is Text && (w.data ?? w.textSpan?.toPlainText())?.toLowerCase() == text.toLowerCase());
