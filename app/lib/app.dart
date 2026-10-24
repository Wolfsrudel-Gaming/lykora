import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'data/controller.dart';
import 'data/session.dart';
import 'model/game.dart';
import 'services/fx.dart';
import 'services/soundscape.dart';
import 'ui/design/components.dart';
import 'ui/design/error_view.dart';
import 'ui/design/text_scale.dart';
import 'ui/design/tokens.dart';
import 'ui/safety/safety_layer.dart';
import 'ui/screens/briefing_screen.dart';
import 'ui/screens/home_screen.dart';
import 'ui/screens/join_screen.dart';
import 'ui/screens/prep_screen.dart';

/// Das Spiel ist für Hochformat gebaut: Sicherheitsleiste, Spielkopf und Aktionszone passen quer nicht auf den Bildschirm.
Future<void> lockPortrait() => SystemChrome.setPreferredOrientations(const [DeviceOrientation.portraitUp]);

/// Einstellungen des Geräts: Lichtmodus, Lesefassung, Schriftgröße, Vorlesen, Ton, Bildschirm.
class AppSettings extends ChangeNotifier {
  AppSettings(this.store) {
    Fx.instance.addListener(_onFx);
    // Solange die Vorlesestimme spricht, ist die Atmosphäre leiser. Anfang und Ende meldet die Stimme
    // selbst; auf das Ende von speak() ist kein Verlass, nach einem Fehler kommt es nie.
    _tts
      ..setStartHandler(() => Fx.instance.duck(_voice))
      ..setContinueHandler(() => Fx.instance.duck(_voice))
      ..setCompletionHandler(_quiet)
      ..setCancelHandler(_quiet)
      ..setPauseHandler(_quiet)
      ..setErrorHandler((_) => _quiet());
  }
  final SessionStore store;
  LightMode lightMode = LightMode.night;

  /// Lesefassung für 6–9 erzwingen (true), abschalten (false) oder nach Spiel (null)
  bool? young;

  /// Regler der App; kommt zur Schrifteinstellung des Systems dazu (siehe [LykoraTextScaler]).
  double textScale = 1.0;

  /// Bildschirm bleibt im laufenden Spiel an. Bei sehr wenig Akku gibt die App ihn von selbst frei.
  bool keepAwake = true;
  bool readAloud = false;
  bool sound = true;
  bool vibration = true;

  /// Lautstärke der Atmosphäre, 0 bis 1
  double ambience = 0.8;
  final FlutterTts _tts = FlutterTts();
  bool _alarm = false;
  static const _voice = #readAloud;

  Future<void> load() async {
    final j = await store.loadSettings();
    // Frühere Fassung kannte nur den Schalter Rotlicht.
    lightMode = j['lightMode'] != null ? LightMode.parse(j['lightMode'] as String?) : (j['redLight'] == true ? LightMode.red : LightMode.night);
    young = j['young'] as bool?;
    textScale = clampDouble((j['textScale'] as num?)?.toDouble() ?? 1.0, minTextScale, maxTextScale);
    keepAwake = j['keepAwake'] as bool? ?? true;
    readAloud = j['readAloud'] as bool? ?? false;
    sound = j['sound'] as bool? ?? true;
    vibration = j['vibration'] as bool? ?? true;
    ambience = ((j['ambience'] as num?)?.toDouble() ?? 0.8).clamp(0.0, 1.0);
    _applyFx();
  }

  Future<void> update({
    LightMode? lightMode,
    Object? young = _keep,
    double? textScale,
    bool? keepAwake,
    bool? readAloud,
    bool? sound,
    bool? vibration,
    double? ambience,
  }) async {
    this.lightMode = lightMode ?? this.lightMode;
    if (young != _keep) this.young = young as bool?;
    this.textScale = clampDouble(textScale ?? this.textScale, minTextScale, maxTextScale);
    this.keepAwake = keepAwake ?? this.keepAwake;
    this.readAloud = readAloud ?? this.readAloud;
    this.sound = sound ?? this.sound;
    this.vibration = vibration ?? this.vibration;
    this.ambience = ambience ?? this.ambience;
    _applyFx();
    notifyListeners();
    await store.saveSettings({
      'lightMode': this.lightMode.name,
      'young': this.young,
      'textScale': this.textScale,
      'keepAwake': this.keepAwake,
      'readAloud': this.readAloud,
      'sound': this.sound,
      'vibration': this.vibration,
      'ambience': this.ambience,
    });
  }

  static const _keep = Object();

  void _applyFx() {
    Fx.instance
      ..sound = sound
      ..vibration = vibration;
    Soundscape.instance.volume = ambience;
    LykoraErrorView.mode = lightMode;
  }

  /// Ein Sicherheitsalarm unterbricht auch das Vorlesen sofort.
  void _onFx() {
    final alarm = Fx.instance.safetyActive;
    if (alarm && !_alarm) stopSpeaking();
    _alarm = alarm;
  }

  @override
  void dispose() {
    Fx.instance.removeListener(_onFx);
    super.dispose();
  }

  /// Reihenfolge des Lichtschalters. Tag ist nicht dabei: Ein Tipp im Dunkeln darf das Team nie blenden.
  static const lightCycle = [LightMode.night, LightMode.red, LightMode.amber];

  /// Hinweis, wo man Tag findet; die Sicherheitsleiste zeigt ihn beim langen Drücken.
  static const dayHint = 'Hell wie am Tag: Lichtschalter lange drücken oder in den Einstellungen wählen.';

  /// Nächster Lichtmodus für den Lichtschalter: Nacht → Rotlicht → Bernstein → Nacht. Aus Tag geht es zurück in die Nacht.
  Future<void> cycleLight() {
    final i = lightCycle.indexOf(lightMode);
    return setLight(i < 0 ? LightMode.night : lightCycle[(i + 1) % lightCycle.length]);
  }

  /// Langes Drücken auf den Lichtschalter: bewusst zu Tag, und wieder zurück zur Nacht.
  Future<void> toggleDay() => setLight(lightMode == LightMode.day ? LightMode.night : LightMode.day);

  /// Setzt den Lichtmodus und sagt ihn für Screenreader an.
  Future<void> setLight(LightMode mode) {
    _announce('Licht: ${mode.label}');
    return update(lightMode: mode);
  }

  /// Ansage für Screenreader; ohne sie bliebe der Wechsel für Blinde stumm.
  void _announce(String text) {
    try {
      final views = ui.PlatformDispatcher.instance.views;
      if (views.isEmpty) return;
      SemanticsService.sendAnnouncement(views.first, text, TextDirection.ltr).catchError((_) {});
    } catch (_) {}
  }

  void _quiet() => Fx.instance.unduck(_voice);

  /// Liest vor; solange die Stimme spricht, ist die Atmosphäre leiser.
  Future<void> speak(String text, {String lang = 'de', double rate = 0.5}) async {
    if (!Fx.enabled) return;
    try {
      await _tts.stop();
      await _tts.setLanguage(lang == 'de' ? 'de-DE' : lang);
      await _tts.setSpeechRate(rate);
      await _tts.speak(text);
    } catch (_) {
      _quiet();
    }
  }

  Future<void> stopSpeaking() async {
    _quiet();
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

/// Hält den Bildschirm im laufenden Spiel an. Andere Seiten (z. B. „Finde mich“) schalten die Sperre beim
/// Schließen selbst aus; deshalb setzt die App sie nach jedem Seitenwechsel und in Abständen wieder.
abstract final class ScreenAwake {
  /// Für Tests ersetzbar. Ohne Ersatz wirkt nur auf dem Gerät.
  @visibleForTesting
  static Future<void> Function(bool on)? driver;

  static bool _want = false;
  static Timer? _timer;

  /// In Widget-Tests ohne Ersatz-[driver] passiert nichts, auch keine Timer.
  static bool get _live => driver != null || Fx.enabled;

  static bool get wanted => _want;

  static void want(bool on) {
    if (on == _want) return;
    _want = on;
    _timer?.cancel();
    _timer = on && _live ? Timer.periodic(const Duration(minutes: 1), (_) => _apply()) : null;
    _apply();
  }

  /// Nach einem Seitenwechsel: Die schließende Seite räumt erst nach ihrer Animation auf.
  static void reassertSoon() {
    if (_want && _live) Timer(const Duration(milliseconds: 900), _apply);
  }

  static void _apply() {
    if (!_live) return;
    try {
      final drive = driver;
      final done = drive != null ? drive(_want) : WakelockPlus.toggle(enable: _want);
      done.catchError((_) {});
    } catch (_) {}
  }

  @visibleForTesting
  static void reset() {
    _timer?.cancel();
    _timer = null;
    _want = false;
    driver = null;
  }
}

class _RouteWatcher extends NavigatorObserver {
  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) => ScreenAwake.reassertSoon();

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) => ScreenAwake.reassertSoon();
}

final _routeWatcher = _RouteWatcher();

/// Unter der Hülle: Bildschirmsperre je nach Spielstand, Einstellung und Akku.
class _AppShell extends StatefulWidget {
  const _AppShell({required this.child});
  final Widget child;

  @override
  State<_AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<_AppShell> with WidgetsBindingObserver {
  Listenable? _listenable;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final l = Listenable.merge([Lykora.game(context), Lykora.prefs(context)]);
    _listenable?.removeListener(_sync);
    _listenable = l..addListener(_sync);
    _sync();
  }

  /// Läuft das Spiel, ist die Einstellung an und reicht der Akku, bleibt der Bildschirm an.
  void _sync() {
    final c = Lykora.game(context);
    final battery = c.battery;
    ScreenAwake.want(Lykora.prefs(context).keepAwake && c.started && !c.finished && !c.eventEnded && (battery == null || battery >= 0.15));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) ScreenAwake.reassertSoon();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _listenable?.removeListener(_sync);
    ScreenAwake.want(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Die Zurück-Geste am Hauptbildschirm beendet das laufende Spiel nicht aus Versehen: erst fragen.
/// Seiten darüber (SOS, Stationen, Einstellungen) schließen sich wie gewohnt.
class _LeaveGuard extends StatelessWidget {
  const _LeaveGuard({required this.active, required this.child});

  /// Nur solange das Spiel läuft; danach darf man die App wie gewohnt verlassen.
  final bool active;
  final Widget child;

  Future<void> _ask(BuildContext context) async {
    final close = await showDialog<bool>(context: context, builder: (_) => const _LeaveDialog());
    if (close == true) await SystemNavigator.pop();
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !active,
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop) _ask(context);
    },
    child: child,
  );
}

class _LeaveDialog extends StatelessWidget {
  const _LeaveDialog();

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Dialog(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Space.gutter),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('App wirklich schließen?', style: t.heading),
            const SizedBox(height: 8),
            Text('Euer Spielstand bleibt gespeichert. Ist die App zu, bekommt ihr aber keine Funksprüche und keine Sicherheitswarnungen mit.', style: t.muted),
            const SizedBox(height: 20),
            LKey(label: 'Weiterspielen', onPressed: () => Navigator.of(context).pop(false)),
            const SizedBox(height: Space.gap),
            LKey(label: 'App schließen', kind: KeyKind.tertiary, onPressed: () => Navigator.of(context).pop(true)),
          ],
        ),
      ),
    );
  }
}

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
          navigatorObservers: [_routeWatcher],
          theme: buildTheme(settings.tokensFor(controller.game)),
          builder: (context, child) {
            final media = MediaQuery.of(context);
            // System-Schriftgröße mal Regler der App, nach oben auf 200 % begrenzt.
            return MediaQuery(
              data: media.copyWith(textScaler: LykoraTextScaler(system: media.textScaler, factor: settings.textScale)),
              child: _AppShell(child: SafetyLayer(child: child!)),
            );
          },
          home: ListenableBuilder(
            listenable: controller,
            builder: (context, _) {
              if (!controller.hasSession || !controller.hasGame) return const JoinScreen();
              if (!controller.started) return const PrepScreen();
              final running = !controller.finished && !controller.eventEnded;
              return _LeaveGuard(active: running, child: controller.session!.introSeen ? const HomeScreen() : const BriefingScreen());
            },
          ),
        ),
      ),
    );
  }
}
