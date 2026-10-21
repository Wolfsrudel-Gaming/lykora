// Erzeugt Bildschirmfotos der App mit dem Beispielspiel, z. B. für Doku und Vorstellung.
// Läuft nur mit LYKORA_SCREENSHOTS=<Zielordner>:
//   LYKORA_SCREENSHOTS=build/screenshots flutter test test/screenshots

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator_platform_interface/geolocator_platform_interface.dart';
import 'package:lykora/app.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/ui/design/components.dart';
import 'package:lykora/ui/design/tokens.dart';
import 'package:lykora/ui/safety/emergency_screen.dart';
import 'package:lykora/ui/safety/sos_screen.dart';
import 'package:lykora/ui/screens/map_view.dart';
import 'package:lykora/ui/screens/prep_screen.dart';
import 'package:lykora/ui/screens/station_screen.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

import '../support.dart';

final _out = Platform.environment['LYKORA_SCREENSHOTS'];

/// Ortung ohne Gerät: Erlaubnis da, Positionen setzt der Test selbst.
class _FakeGeolocator extends GeolocatorPlatform with MockPlatformInterfaceMixin {
  @override
  Future<bool> isLocationServiceEnabled() async => true;
  @override
  Future<LocationPermission> checkPermission() async => LocationPermission.always;
  @override
  Future<LocationPermission> requestPermission() async => LocationPermission.always;
  @override
  Stream<Position> getPositionStream({LocationSettings? locationSettings}) => const Stream.empty();
}

/// Dasselbe Spiel als Mystery für 6–9: andere Welt, Fibelschrift, Standardnamen des Genres.
Map<String, dynamic> _mysteryGame() {
  final g = jsonDecode(jsonEncode(gameJson)) as Map<String, dynamic>;
  g['id'] = '${g['id']}-mystery';
  (g['meta'] as Map)['genre'] = 'mystery';
  (g['meta'] as Map)['ageGroups'] = ['6-9'];
  (g['meta'] as Map)['title'] = {'de': 'Das Irrlicht vom Ahrenbach'};
  g.remove('presentation');
  return g;
}

void main() {
  testWidgets('Bildschirmfotos', (tester) async {
    GameMap.showTiles = false;
    GeolocatorPlatform.instance = _FakeGeolocator();
    // Deep-Links gibt es im Test nicht.
    tester.binding.defaultBinaryMessenger.setMockStreamHandler(
      const EventChannel('com.llfbandit.app_links/events'),
      MockStreamHandler.inline(onListen: (_, _) {}),
    );
    await tester.runAsync(loadAppFonts);
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final outDir = Directory(_out!)..createSync(recursive: true);

    var server = FakeServer();
    late GameController c;
    late AppSettings settings;
    Future<void> fresh(FakeServer s) async {
      await tester.runAsync(() async {
        final store = SessionStore(await Directory.systemTemp.createTemp('lykora-shots-'));
        c = GameController(
          store: store,
          apiFactory: (a, t) => Api(a, token: t, client: s.client()),
          backgroundLoops: false,
        );
        settings = AppSettings(store);
      });
    }

    await fresh(server);
    Future<T> run<T>(Future<T> Function() f) async => (await tester.runAsync(f)) as T;

    final key = GlobalKey();
    Widget app() => RepaintBoundary(
      key: key,
      child: LykoraApp(controller: c, settings: settings),
    );

    // Wechselt zwischen echter Ereignisschleife (Dateien) und simulierter Zeit (Animationen).
    Future<void> settle([int frames = 8]) async {
      for (var i = 0; i < frames; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 15)));
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    Future<void> tap(Finder f) async {
      await tester.runAsync(() async {
        await tester.tap(f.first, warnIfMissed: false);
        await Future<void>.delayed(const Duration(milliseconds: 200));
      });
      await settle();
    }

    Future<void> shot(String name) async {
      // Im Test vergeht keine echte Zeit; eingeblendete Hinweise sonst auf allen folgenden Bildern.
      for (final m in tester.stateList<ScaffoldMessengerState>(find.byType(ScaffoldMessenger))) {
        m.clearSnackBars();
      }
      await settle(4);
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(key));
      final image = await run(() => boundary.toImage(pixelRatio: 3));
      final bytes = await run(() async => (await image.toByteData(format: ui.ImageByteFormat.png))!);
      File('${outDir.path}/$name.png').writeAsBytesSync(bytes.buffer.asUint8List());
    }

    Future<void> push(Widget page, {bool iris = false}) async {
      unawaited(navigatorKey.currentState!.push(iris ? IrisRoute<void>(builder: (_) => page) : MaterialPageRoute<void>(builder: (_) => page)));
      await settle(10);
    }

    Future<void> popAll() async {
      navigatorKey.currentState!.popUntil((r) => r.isFirst);
      await settle();
    }

    // 1. Einstieg
    await tester.pumpWidget(app());
    await settle();
    await shot('01-einstieg');

    // 2. Team in drei Schritten
    await tester.enterText(find.byType(TextField).first, 'K7M2QX');
    await settle();
    await tap(find.text('Weiter'));
    await tap(find.text('Nachtfalken'));
    FocusManager.instance.primaryFocus?.unfocus();
    await shot('02-team-name');
    await tap(find.text('Weiter'));
    await tap(find.text('Weiter'));
    await shot('03-team-betreuer');
    await popAll();

    // Beitreten wie nach „Los“
    await run(() async {
      await c.join(server: 'https://riegel-troisdorf.de/lykora', code: 'K7M2QX', teamName: 'Nachtfalken', color: 'orange', members: ['Anna', 'Ben', 'Cem']);
      c.battery = 0.86;
    });
    await settle(3);

    // 4. Packen
    await shot('04-packen');
    await settle(40);
    await run(() => c.onPosition(50.81552, 7.15505, 6));
    for (final gear in ['Lampe', 'Warnweste']) {
      await tester.scrollUntilVisible(find.text(gear), 200, scrollable: find.byType(Scrollable).first);
      await tap(find.text(gear));
    }
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 2000));
    await settle();

    // 5. Startklar
    await shot('05-startklar');

    // 6. Briefing
    await run(() => c.start());
    await settle();
    await shot('06-briefing');
    await tap(find.text('Verstanden, Zentrale!'));

    // Erste Station erledigt, unterwegs zum Baum
    await run(() async {
      await c.trigger('briefing', 'qr');
      await c.markSceneSeen('briefing');
      await c.answer('briefing', {
        'choice': [0],
      });
      for (final (lat, lon) in [(50.81555, 7.1553), (50.8156, 7.1556), (50.81568, 7.1559), (50.81575, 7.1561)]) {
        await c.onPosition(lat, lon, 6);
      }
    });
    await settle(10);

    // 7. Peilen
    await shot('07-peilen');

    // 8. Karte und 9. Liste
    await tap(find.text('Karte'));
    await shot('08-karte');
    await tap(find.text('Liste'));
    await shot('09-liste');
    await tap(find.text('Peilen'));

    // 10.–12. Station als Szene
    await run(() async {
      await c.onPosition(50.81598, 7.15648, 5);
    });
    await settle(10);
    await push(const StationScreen(stationId: 'baum'), iris: true);
    await shot('10-szene-funk');
    await tap(find.text('Weiter'));
    await shot('11-szene-erzaehler');
    await tap(find.text('Zum Rätsel'));
    await run(() => c.hint('baum'));
    await settle();
    await tester.enterText(find.byType(TextField), 'Eule');
    FocusManager.instance.primaryFocus?.unfocus();
    await shot('12-raetsel');

    // 13. Belohnung
    await tap(find.text('Prüfen'));
    await settle(30);
    await shot('13-belohnung');
    await popAll();

    // 14.–16. Dialog, Dokument, Zahlenschloss
    await run(() async {
      await c.onPosition(50.8149, 7.1559, 5);
    });
    await settle();
    await push(const StationScreen(stationId: 'schloss'), iris: true);
    await tap(find.text('Wer war das?'));
    await shot('14-dialog');
    await tap(find.text('Weiter'));
    await shot('15-dokument');
    await tap(find.text('Zum Rätsel'));
    for (final (label, n) in [('Rad 1 hoch', 3), ('Rad 2 runter', 3), ('Rad 3 hoch', 1)]) {
      for (var i = 0; i < n; i++) {
        await tester.tap(find.bySemanticsLabel(label));
        await tester.pump(const Duration(milliseconds: 50));
      }
    }
    await shot('16-zahlenschloss');
    await popAll();

    // Schloss gelöst, Zentrale meldet sich
    server.pendingMessages.addAll([
      {'kind': 'chat', 'body': 'Zentrale an Nachtfalken: Gute Arbeit am Baum! Achtet auf die Straße im Norden.'},
    ]);
    await run(() async {
      await c.answer('schloss', {'text': '372'});
      await c.sendMessage('Wir haben die Kiste gefunden!', kind: 'chat');
      await c.sync();
    });
    await settle();

    // 17. Funk und 18. Akte
    await tap(find.text('Funk'));
    await shot('17-funk');
    await tap(find.text('Einsatzprotokoll'));
    await shot('18-akte');

    // 19. Finale: Teile einsetzen
    await run(() async {
      await c.trigger('versteck', 'gps');
      await c.answer('versteck', {'upload': 'foto-1'});
      await c.onPosition(50.81552, 7.15505, 5);
      await c.trigger('finale', 'qr');
      await c.markSceneSeen('finale');
    });
    await settle(10);
    await push(const StationScreen(stationId: 'finale'), iris: true);
    for (final i in [0, 1]) {
      await tester.tap(find.byType(FragmentToken).at(i));
      await tester.pump(const Duration(milliseconds: 120));
    }
    await shot('19-finale');
    await tester.tap(find.byType(FragmentToken).at(2));
    await settle();

    // 20. Geschafft
    await tap(find.text('Öffnen'));
    await settle(30);
    await shot('20-geschafft');
    await popAll();
    await tap(find.text('Weg'));

    // 21. Sperrzone in der Nähe und 22. drin
    await run(() => c.onPosition(50.81662, 7.1552, 5));
    await settle();
    await shot('21-sperrzone-warnung');
    await run(() => c.onPosition(50.8169, 7.1552, 5));
    await settle();
    await shot('22-sperrzone');
    await run(() => c.onPosition(50.8160, 7.1565, 5));
    await settle(40);

    // 23. Rückruf „Alle zurück“ und Lebenszeichen
    server.status = 'recalled';
    await run(() => c.sync());
    await settle();
    await shot('23-rueckruf');
    await tap(find.text('Wir sind unterwegs'));
    await run(() async {
      c.session!.lastHeartbeatAt = c.now() - 20 * 60 * 1000;
    });
    await settle();
    await shot('24-rueckruf-unterwegs');

    // 25. SOS und 26. Notfallinfos
    await push(const SosScreen());
    await tap(find.text('Verletzt'));
    await shot('25-sos');
    await popAll();
    await push(const EmergencyScreen());
    await shot('26-notfallinfos');
    await popAll();
    server.status = 'running';
    await run(() async {
      await c.heartbeat();
      await c.sync();
    });
    await settle();

    // 27.–29. Lichtmodi
    await run(() => settings.update(lightMode: LightMode.red));
    await settle();
    await shot('27-rotlicht');
    await run(() => settings.update(lightMode: LightMode.amber));
    await push(const StationScreen(stationId: 'schloss'));
    await shot('28-bernstein');
    await popAll();
    await run(() => settings.update(lightMode: LightMode.day));
    await tap(find.text('Einsatzprotokoll'));
    await shot('29-tag');
    await run(() => settings.update(lightMode: LightMode.night));

    // 30.–32. Andere Spielwelt: Mystery für 6–9
    c.stopLoops();
    await tester.pumpWidget(const SizedBox());
    server = FakeServer(game: _mysteryGame());
    await fresh(server);
    PrepScreen.skipPacking = true;
    await run(() async {
      await c.join(server: 'https://riegel-troisdorf.de/lykora', code: 'K7M2QX', teamName: 'Glühwürmchen', members: ['Mia', 'Paul']);
      await c.start();
      await c.markIntroSeen();
      await c.trigger('briefing', 'qr');
      await c.markSceneSeen('briefing');
      await c.answer('briefing', {
        'choice': [0],
      });
      for (final (lat, lon) in [(50.8157, 7.1558), (50.81575, 7.1561)]) {
        await c.onPosition(lat, lon, 6);
      }
    });
    await tester.pumpWidget(app());
    await settle(10);
    await shot('30-mystery-peilen');
    await run(() async {
      await c.trigger('briefing', 'qr');
    });
    await push(const StationScreen(stationId: 'briefing'));
    await shot('31-mystery-geloest');
    await popAll();
    await run(() async {
      await c.trigger('schloss', 'qr');
      await c.markSceneSeen('schloss');
    });
    await push(const StationScreen(stationId: 'schloss'));
    await shot('32-mystery-raetsel');
    await popAll();

    c.stopLoops();
    await tester.pumpWidget(const SizedBox());
  }, skip: _out == null);
}
