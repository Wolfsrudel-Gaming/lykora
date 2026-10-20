import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';

import 'data/controller.dart';
import 'data/session.dart';
import 'model/game.dart';
import 'ui/screens/home_screen.dart';
import 'ui/screens/join_screen.dart';
import 'ui/screens/prep_screen.dart';
import 'ui/theme.dart';

/// Einstellungen des Geräts: Rotlicht, Schriftgröße, Vorlesen.
class AppSettings extends ChangeNotifier {
  AppSettings(this.store);
  final SessionStore store;
  bool redLight = false;
  double textScale = 1.0;
  bool readAloud = false;
  final FlutterTts _tts = FlutterTts();

  Future<void> load() async {
    final j = await store.loadSettings();
    redLight = j['redLight'] as bool? ?? false;
    textScale = (j['textScale'] as num?)?.toDouble() ?? 1.0;
    readAloud = j['readAloud'] as bool? ?? false;
  }

  Future<void> update({bool? redLight, double? textScale, bool? readAloud}) async {
    this.redLight = redLight ?? this.redLight;
    this.textScale = textScale ?? this.textScale;
    this.readAloud = readAloud ?? this.readAloud;
    notifyListeners();
    await store.saveSettings({'redLight': this.redLight, 'textScale': this.textScale, 'readAloud': this.readAloud});
  }

  Future<void> speak(String text, {String lang = 'de'}) async {
    await _tts.stop();
    await _tts.setLanguage(lang == 'de' ? 'de-DE' : lang);
    await _tts.speak(text);
  }

  Future<void> stopSpeaking() => _tts.stop();
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
        listenable: settings,
        builder: (context, _) => MaterialApp(
          title: 'Lykora',
          debugShowCheckedModeBanner: false,
          theme: lykoraTheme(Brightness.light),
          darkTheme: lykoraTheme(Brightness.dark),
          themeMode: ThemeMode.dark,
          builder: (context, child) {
            final media = MediaQuery.of(context);
            Widget result = MediaQuery(data: media.copyWith(textScaler: TextScaler.linear(settings.textScale)), child: child!);
            // Rotlicht: alles nur in Rot, damit die Augen an die Dunkelheit gewöhnt bleiben.
            if (settings.redLight) result = ColorFiltered(colorFilter: redLightFilter, child: result);
            return result;
          },
          home: ListenableBuilder(
            listenable: controller,
            builder: (context, _) {
              if (!controller.hasSession || !controller.hasGame) return const JoinScreen();
              if (!controller.started) return const PrepScreen();
              return const HomeScreen();
            },
          ),
        ),
      ),
    );
  }
}
