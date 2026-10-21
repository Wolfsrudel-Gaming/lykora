import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';

import 'data/controller.dart';
import 'data/session.dart';
import 'model/game.dart';
import 'services/fx.dart';
import 'ui/design/tokens.dart';
import 'ui/safety/safety_layer.dart';
import 'ui/screens/briefing_screen.dart';
import 'ui/screens/home_screen.dart';
import 'ui/screens/join_screen.dart';
import 'ui/screens/prep_screen.dart';

/// Einstellungen des Geräts: Lichtmodus, Lesefassung, Schriftgröße, Vorlesen, Ton.
class AppSettings extends ChangeNotifier {
  AppSettings(this.store);
  final SessionStore store;
  LightMode lightMode = LightMode.night;

  /// Lesefassung für 6–9 erzwingen (true), abschalten (false) oder nach Spiel (null)
  bool? young;
  double textScale = 1.0;
  bool readAloud = false;
  bool sound = true;
  bool vibration = true;
  final FlutterTts _tts = FlutterTts();

  Future<void> load() async {
    final j = await store.loadSettings();
    // Frühere Fassung kannte nur den Schalter Rotlicht.
    lightMode = j['lightMode'] != null ? LightMode.parse(j['lightMode'] as String?) : (j['redLight'] == true ? LightMode.red : LightMode.night);
    young = j['young'] as bool?;
    textScale = (j['textScale'] as num?)?.toDouble() ?? 1.0;
    readAloud = j['readAloud'] as bool? ?? false;
    sound = j['sound'] as bool? ?? true;
    vibration = j['vibration'] as bool? ?? true;
    _applyFx();
  }

  Future<void> update({LightMode? lightMode, Object? young = _keep, double? textScale, bool? readAloud, bool? sound, bool? vibration}) async {
    this.lightMode = lightMode ?? this.lightMode;
    if (young != _keep) this.young = young as bool?;
    this.textScale = textScale ?? this.textScale;
    this.readAloud = readAloud ?? this.readAloud;
    this.sound = sound ?? this.sound;
    this.vibration = vibration ?? this.vibration;
    _applyFx();
    notifyListeners();
    await store.saveSettings({
      'lightMode': this.lightMode.name,
      'young': this.young,
      'textScale': this.textScale,
      'readAloud': this.readAloud,
      'sound': this.sound,
      'vibration': this.vibration,
    });
  }

  static const _keep = Object();

  void _applyFx() {
    Fx.instance
      ..sound = sound
      ..vibration = vibration;
  }

  /// Nächster Lichtmodus für den Lichtschalter: Nacht → Rotlicht → Bernstein → Tag.
  Future<void> cycleLight() => update(lightMode: LightMode.values[(lightMode.index + 1) % LightMode.values.length]);

  Future<void> speak(String text, {String lang = 'de', double rate = 0.5}) async {
    if (!Fx.enabled) return;
    try {
      await _tts.stop();
      await _tts.setLanguage(lang == 'de' ? 'de-DE' : lang);
      await _tts.setSpeechRate(rate);
      await _tts.speak(text);
    } catch (_) {}
  }

  Future<void> stopSpeaking() async {
    if (!Fx.enabled) return;
    try {
      await _tts.stop();
    } catch (_) {}
  }

  /// Design-Tokens für das laufende Spiel.
  LykoraTokens tokensFor(Game? game) => LykoraTokens(mode: lightMode, genre: Genre.parse(game?.genre), young: young ?? game?.youngOnly ?? false);
}

/// Macht Steuerung und Einstellungen überall im Widget-Baum erreichbar.
class Lykora extends InheritedWidget {
  const Lykora({super.key, required this.controller, required this.settings, required super.child});
  final GameController controller;
  final AppSettings settings;

  static Lykora of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<Lykora>()!;
  static GameController game(BuildContext context) => of(context).controller;
  static AppSettings prefs(BuildContext context) => of(context).settings;

  @override
  bool updateShouldNotify(Lykora old) => controller != old.controller || settings != old.settings;
}

extension LTextContext on LText {
  /// Text in der Sprache des Spiels.
  String of(BuildContext context) => resolve(Lykora.game(context).game?.language ?? 'de');

  /// Text oder Ersatz, falls leer.
  String or(BuildContext context, String fallback) => isEmpty ? fallback : of(context);
}

/// Navigator der App, damit die Sicherheitsebene über allen Routen Seiten öffnen kann.
final navigatorKey = GlobalKey<NavigatorState>();

class LykoraApp extends StatelessWidget {
  const LykoraApp({super.key, required this.controller, required this.settings});
  final GameController controller;
  final AppSettings settings;

  @override
  Widget build(BuildContext context) {
    return Lykora(
      controller: controller,
      settings: settings,
      child: ListenableBuilder(
        // Spielwelt wechselt mit dem Spiel, Lichtmodus mit den Einstellungen.
        listenable: Listenable.merge([settings, controller.gameId]),
        builder: (context, _) => MaterialApp(
          title: 'Lykora',
          debugShowCheckedModeBanner: false,
          navigatorKey: navigatorKey,
          theme: buildTheme(settings.tokensFor(controller.game)),
          builder: (context, child) {
            final media = MediaQuery.of(context);
            return MediaQuery(
              data: media.copyWith(textScaler: TextScaler.linear(settings.textScale)),
              child: SafetyLayer(child: child!),
            );
          },
          home: ListenableBuilder(
            listenable: controller,
            builder: (context, _) {
              if (!controller.hasSession || !controller.hasGame) return const JoinScreen();
              if (!controller.started) return const PrepScreen();
              if (!controller.session!.introSeen) return const BriefingScreen();
              return const HomeScreen();
            },
          ),
        ),
      ),
    );
  }
}
