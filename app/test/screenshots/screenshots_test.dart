// Erzeugt Bildschirmfotos der App mit dem Beispielspiel, z. B. für Doku und Vorstellung.
// Läuft nur mit LYKORA_SCREENSHOTS=<Zielordner>:
//   LYKORA_SCREENSHOTS=build/screenshots flutter test test/screenshots

import 'dart:async';
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
import 'package:lykora/ui/screens/emergency_screen.dart';
import 'package:lykora/ui/screens/headcount_screen.dart';
import 'package:lykora/ui/screens/map_tab.dart';
import 'package:lykora/ui/screens/sos_screen.dart';
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

Future<void> _loadFonts() async {
  final dir = '${Platform.environment['FLUTTER_ROOT'] ?? '/var/tmp/flutter'}/bin/cache/artifacts/material_fonts';
  final roboto = FontLoader('Roboto');
  for (final f in ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Bold.ttf', 'Roboto-Black.ttf']) {
    roboto.addFont(Future.value(ByteData.sublistView(File('$dir/$f').readAsBytesSync())));
  }
  await roboto.load();
  final icons = FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File('$dir/MaterialIcons-Regular.otf').readAsBytesSync())));
  await icons.load();
}

void main() {
  testWidgets('Bildschirmfotos', (tester) async {
    MapTab.showTiles = false;
    GeolocatorPlatform.instance = _FakeGeolocator();
    // Deep-Links gibt es im Test nicht.
    tester.binding.defaultBinaryMessenger.setMockStreamHandler(
      const EventChannel('com.llfbandit.app_links/events'),
      MockStreamHandler.inline(onListen: (_, _) {}),
    );
    await tester.runAsync(_loadFonts);
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final outDir = Directory(_out!)..createSync(recursive: true);

    final server = FakeServer();
    late GameController c;
    late AppSettings settings;
    await tester.runAsync(() async {
      final store = SessionStore(await Directory.systemTemp.createTemp('lykora-shots-'));
      c = GameController(store: store, apiFactory: (s, t) => Api(s, token: t, client: server.client()), backgroundLoops: false);
      settings = AppSettings(store);
    });
    Future<T> run<T>(Future<T> Function() f) async => (await tester.runAsync(f)) as T;

    final key = GlobalKey();
    final app = RepaintBoundary(key: key, child: LykoraApp(controller: c, settings: settings));

    // Feste Zahl von Frames statt pumpAndSettle: Cursor und Sekundentakt hören nie auf.
    Future<void> settle() async {
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    Future<void> shot(String name, {bool keepSnackBar = false}) async {
      // Im Test vergeht keine echte Zeit; eingeblendete Hinweise sonst auf allen folgenden Bildern.
      if (!keepSnackBar) {
        for (final m in tester.stateList<ScaffoldMessengerState>(find.byType(ScaffoldMessenger))) {
          m.clearSnackBars();
        }
      }
      for (var i = 0; i < 4; i++) {
        await tester.pump(const Duration(milliseconds: 120));
      }
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(key));
      final image = await run(() => boundary.toImage(pixelRatio: 3));
      final bytes = await run(() async => (await image.toByteData(format: ui.ImageByteFormat.png))!);
      File('${outDir.path}/$name.png').writeAsBytesSync(bytes.buffer.asUint8List());
    }

    Future<void> push(Widget page) async {
      final nav = tester.state<NavigatorState>(find.byType(Navigator).last);
      unawaited(nav.push(MaterialPageRoute<void>(builder: (_) => page)));
      await settle();
    }

    Future<void> pop() async {
      tester.state<NavigatorState>(find.byType(Navigator).last).pop();
      await settle();
    }

    // 1. Einstieg
    await tester.pumpWidget(app);
    await shot('01-einstieg');

    // 2. Team anlegen
    await tester.enterText(find.byType(TextField).first, 'K7M2QX');
    await tester.tap(find.text('Weiter'));
    await settle();
    await tester.enterText(find.widgetWithText(TextFormField, 'Teamname'), 'Füchse');
    await tester.tap(find.text('Rot'));
    await tester.enterText(find.widgetWithText(TextField, 'Vorname'), 'Anna');
    FocusManager.instance.primaryFocus?.unfocus();
    await shot('02-team');
    await pop();

    // Beitreten wie nach „Los“, mit Armbändern für Anna und Ben
    await run(() async {
      await c.join(server: 'https://riegel-troisdorf.de/lykora', code: 'K7M2QX', teamName: 'Füchse', color: 'red');
      await c.updateMembers([Member('Anna', c.hashTag('04A1')), Member('Ben', c.hashTag('04B2')), Member('Cem')]);
      await c.onPosition(50.81552, 7.15505, 6);
    });

    // 3. Vorbereitung
    await shot('03-vorbereitung');

    // 4. Vollzähligkeit vor dem Start
    await push(const HeadcountScreen(reason: 'start'));
    await shot('04-vollzaehligkeit');
    await pop();

    // Start und erste Station
    await run(() async {
      await c.headcount([c.hashTag('04A1'), c.hashTag('04B2')], 'start');
      await c.start();
      await c.trigger('briefing', 'qr');
      await c.answer('briefing', {'choice': [0]});
      await c.onPosition(50.81575, 7.15585, 7);
    });
    await tester.pump(const Duration(milliseconds: 500));

    // 5. Karte
    await shot('05-karte');

    // 6. Stationsliste
    await tester.tap(find.text('Stationen').last);
    await shot('06-stationen');

    // 7. Station mit Story, Aufgabe und Hinweis
    await run(() async {
      await c.onPosition(50.81598, 7.15648, 5);
      await c.hint('baum');
    });
    await push(const StationScreen(stationId: 'baum'));
    await shot('07-station');

    // 8. Gelöst
    await run(() => c.answer('baum', {'text': 'eule'}));
    await shot('08-geloest');
    await pop();

    // Weiter: Schloss lösen, Versteck erscheint, Zentrale meldet sich
    server.pendingMessages.addAll([
      {'kind': 'chat', 'body': 'Zentrale an Füchse: Gute Arbeit am Baum! Achtet auf die Straße im Norden.'},
      {'kind': 'hint', 'body': 'Die UV-Lampe zeigt mehr, als ihr denkt.'},
    ]);
    await run(() async {
      await c.trigger('schloss', 'gps');
      await c.answer('schloss', {'text': '372'});
      await c.sendMessage('Wir haben die Kiste gefunden!');
      await c.sync();
    });

    // 9. Zentrale
    await tester.tap(find.text('Zentrale').last);
    await shot('09-zentrale');

    // 10. Rucksack
    await tester.tap(find.text('Rucksack').last);
    await shot('10-rucksack');

    // 11. Finale
    await run(() async {
      await c.trigger('versteck', 'gps');
      await c.answer('versteck', {'upload': 'foto-1'});
      await c.trigger('finale', 'qr');
    });
    await push(const StationScreen(stationId: 'finale'));
    await shot('11-finale');
    await pop();

    // 12. Sperrzone und Lebenszeichen
    await run(() async {
      c.session!.lastHeartbeatAt = c.now() - 20 * 60 * 1000;
      await c.onPosition(50.81662, 7.1552, 5);
    });
    await tester.tap(find.text('Karte').last);
    await shot('12-sperrzone');

    // 13. Rückruf „Alle zurück“
    server.status = 'recalled';
    await run(() async {
      await c.heartbeat();
      await c.onPosition(50.8160, 7.1565, 5);
      await c.sync();
    });
    await shot('13-rueckruf');

    // 14. SOS
    await push(const SosScreen());
    await shot('14-sos');
    await pop();

    // 15. Notfallinfos
    await push(const EmergencyScreen());
    await shot('15-notfallinfos');
    await pop();

    // 16. Rotlicht-Modus
    await run(() => settings.update(redLight: true));
    await push(const StationScreen(stationId: 'finale'));
    await shot('16-rotlicht');
    await pop();
    await run(() => settings.update(redLight: false));

    c.stopLoops();
    await tester.pumpWidget(const SizedBox());
  }, skip: _out == null);
}
