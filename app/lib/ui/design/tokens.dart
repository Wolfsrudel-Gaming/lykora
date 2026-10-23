// Design-Tokens der Spieler-App: „Laternenprinzip“.
//
// Auf jedem Bildschirm leuchtet nur, was gerade zählt; alles andere bleibt Nacht.
// Lichtmodi sind eigene Paletten (kein Farbfilter), damit Kontraste in jedem Modus stimmen.
// Spielwelten (Genres) tauschen Akzent, Flächenton, Titelschrift und Wörter, nie die Struktur
// und nie die Sicherheit. Kontraste prüft test/design_test.dart nach der WCAG-Formel.

import 'package:flutter/material.dart';

enum LightMode {
  night('Nacht'),
  red('Rotlicht'),
  amber('Bernstein'),
  day('Tag');

  const LightMode(this.label);
  final String label;

  static LightMode parse(String? v) => LightMode.values.firstWhere((m) => m.name == v, orElse: () => LightMode.night);
}

enum Genre {
  other,
  crime,
  mystery,
  agents,
  rescue;

  static Genre parse(String? v) => Genre.values.firstWhere((g) => g.name == v, orElse: () => Genre.other);
}

/// Farben eines Lichtmodus in einer Spielwelt.
@immutable
class Palette {
  const Palette({
    required this.ground,
    required this.surface,
    required this.raised,
    required this.line,
    required this.text,
    required this.textMuted,
    required this.edge,
    required this.accent,
    required this.accentBright,
    required this.onAccent,
    required this.safety,
    required this.onSafety,
    required this.safetyRing,
    required this.tapeA,
    required this.tapeB,
    required this.brightness,
  });

  /// Grund aller Bildschirme
  final Color ground;

  /// Karten, Flächen
  final Color surface;

  /// Eingabefelder, erhöhte Flächen
  final Color raised;

  /// Nur Dekor, nie Rand eines Bedienelements
  final Color line;
  final Color text;
  final Color textMuted;

  /// Ränder von Bedienelementen und Zustand „erledigt“ (erloschen)
  final Color edge;

  /// Haupthandlung, offene Stationen
  final Color accent;

  /// „Geweckt“, Fokus, Lichtkegel
  final Color accentBright;
  final Color onAccent;

  /// Reserviert für echte Sicherheit (SOS, Rückruf, Sperrzone). Nie für die Geschichte.
  final Color safety;
  final Color onSafety;
  final Color safetyRing;

  /// Absperrband
  final Color tapeA;
  final Color tapeB;
  final Brightness brightness;
}

/// Was eine Spielwelt ausmacht.
@immutable
class GenreStyle {
  const GenreStyle({
    required this.accent,
    required this.onAccent,
    required this.accentDay,
    required this.surfaceNight,
    required this.display,
    required this.displayWeight,
    required this.displayUpper,
    required this.device,
    required this.caseFile,
    required this.stamp,
    required this.rewardShape,
  });

  final Color accent;
  final Color onAccent;

  /// Akzent im Tagmodus, abgedunkelt für hellen Grund
  final Color accentDay;
  final Color surfaceNight;

  /// Titelschrift: nur Kapitelkarten, Stationstitel, Stempel. Nie Fließtext, nie Sicherheit.
  final String display;
  final FontWeight displayWeight;
  final bool displayUpper;

  /// Standardnamen, falls das Spiel keine eigenen setzt
  final String device;
  final String caseFile;
  final String stamp;

  /// Siegel (rund, gezackt) oder Stempel (rechteckig)
  final RewardShape rewardShape;
}

enum RewardShape { seal, stamp }

const genreStyles = <Genre, GenreStyle>{
  Genre.other: GenreStyle(
    accent: Color(0xFFF2A33A),
    onAccent: Color(0xFF1A1104),
    accentDay: Color(0xFF8F4E00),
    surfaceNight: Color(0xFF16181C),
    display: 'Fraunces',
    displayWeight: FontWeight.w600,
    displayUpper: false,
    device: 'Laterne',
    caseFile: 'Rucksack',
    stamp: 'Gefunden',
    rewardShape: RewardShape.seal,
  ),
  Genre.crime: GenreStyle(
    accent: Color(0xFFE8BE6A),
    onAccent: Color(0xFF1A1104),
    accentDay: Color(0xFF7A5410),
    surfaceNight: Color(0xFF1A1610),
    display: 'Courier Prime',
    displayWeight: FontWeight.w700,
    displayUpper: true,
    device: 'Spürnase',
    caseFile: 'Fallakte',
    stamp: 'Gelöst',
    rewardShape: RewardShape.stamp,
  ),
  Genre.mystery: GenreStyle(
    accent: Color(0xFF8FE3CF),
    onAccent: Color(0xFF06231C),
    accentDay: Color(0xFF0C6650),
    surfaceNight: Color(0xFF11171A),
    display: 'IM Fell English SC',
    displayWeight: FontWeight.w400,
    displayUpper: false,
    device: 'Irrlicht-Glas',
    caseFile: 'Tagebuch der Nacht',
    stamp: 'Enthüllt',
    rewardShape: RewardShape.seal,
  ),
  Genre.agents: GenreStyle(
    accent: Color(0xFF6CCBFF),
    onAccent: Color(0xFF03121C),
    accentDay: Color(0xFF0A5B85),
    surfaceNight: Color(0xFF0D141A),
    display: 'Chakra Petch',
    displayWeight: FontWeight.w600,
    displayUpper: true,
    device: 'Signalpeiler',
    caseFile: 'Dossier',
    stamp: 'Zugang gewährt',
    rewardShape: RewardShape.stamp,
  ),
  Genre.rescue: GenreStyle(
    accent: Color(0xFFFFD84A),
    onAccent: Color(0xFF1A1500),
    accentDay: Color(0xFF6B5500),
    surfaceNight: Color(0xFF17171B),
    display: 'Barlow Condensed',
    displayWeight: FontWeight.w700,
    displayUpper: true,
    device: 'Peilempfänger',
    caseFile: 'Einsatzprotokoll',
    stamp: 'Auftrag erfüllt',
    rewardShape: RewardShape.stamp,
  ),
};

/// Sicherheitsrot: reserviert, keine Spielwelt darf es benutzen.
const safetyRed = Color(0xFFC8201A);

Palette paletteFor(LightMode mode, Genre genre) {
  final g = genreStyles[genre]!;
  switch (mode) {
    case LightMode.night:
      return Palette(
        ground: const Color(0xFF0B0C0E),
        surface: g.surfaceNight,
        raised: const Color(0xFF20232A),
        line: const Color(0xFF2E323A),
        text: const Color(0xFFEDE6D8),
        textMuted: const Color(0xFFBDB5A6),
        edge: const Color(0xFF8A8F99),
        accent: g.accent,
        accentBright: Color.lerp(g.accent, Colors.white, 0.35)!,
        onAccent: g.onAccent,
        safety: safetyRed,
        onSafety: Colors.white,
        safetyRing: Colors.white,
        tapeA: safetyRed,
        tapeB: Colors.white,
        brightness: Brightness.dark,
      );
    case LightMode.red:
      // Reines Rot schafft 5,25:1 auf Schwarz; mehr Stufen gibt es nicht, gedimmt wird über die Helligkeit.
      return const Palette(
        ground: Color(0xFF000000),
        surface: Color(0xFF1A0000),
        raised: Color(0xFF260000),
        line: Color(0xFF3A0000),
        text: Color(0xFFFF0000),
        textMuted: Color(0xFFFF0000),
        edge: Color(0xFFC80000),
        accent: Color(0xFFFF0000),
        accentBright: Color(0xFFFF0000),
        onAccent: Color(0xFF000000),
        safety: Color(0xFFFF0000),
        onSafety: Color(0xFF000000),
        safetyRing: Color(0xFF000000),
        tapeA: Color(0xFFFF0000),
        tapeB: Color(0xFF000000),
        brightness: Brightness.dark,
      );
    case LightMode.amber:
      return const Palette(
        ground: Color(0xFF000000),
        surface: Color(0xFF140C00),
        raised: Color(0xFF1E1300),
        line: Color(0xFF3A2600),
        text: Color(0xFFFFB000),
        textMuted: Color(0xFFC98A00),
        edge: Color(0xFFC98A00),
        accent: Color(0xFFFFB000),
        accentBright: Color(0xFFFFC640),
        onAccent: Color(0xFF000000),
        safety: Color(0xFFFFB000),
        onSafety: Color(0xFF000000),
        safetyRing: Color(0xFF000000),
        tapeA: Color(0xFFFFB000),
        tapeB: Color(0xFF000000),
        brightness: Brightness.dark,
      );
    case LightMode.day:
      return Palette(
        ground: const Color(0xFFF3EEE4),
        surface: const Color(0xFFFFFFFF),
        raised: const Color(0xFFECE5D8),
        line: const Color(0xFFD9D0C0),
        text: const Color(0xFF1C1A16),
        textMuted: const Color(0xFF5C564C),
        edge: const Color(0xFF5C564C),
        accent: g.accentDay,
        accentBright: g.accentDay,
        onAccent: Colors.white,
        safety: safetyRed,
        onSafety: Colors.white,
        safetyRing: Colors.white,
        tapeA: safetyRed,
        tapeB: Colors.white,
        brightness: Brightness.light,
      );
  }
}

/// Schriftfamilien. Alle als Assets gebündelt, siehe pubspec.yaml und tool/fonts.py.
abstract final class Fonts {
  static const ui = 'Atkinson Next';
  static const mono = 'Atkinson Mono';
  static const reader = 'Lykora Fibel';
  static const brand = 'Fraunces';

  /// Kleinste Schrift in der ganzen App (sp). Nachts im Freien ist alles darunter nicht mehr lesbar.
  static const minSize = 12.0;
}

/// Bewegung: Dauern und Kurven.
abstract final class Motion {
  static const tick = Duration(milliseconds: 120);
  static const enter = Duration(milliseconds: 240);
  static const leave = Duration(milliseconds: 160);
  static const iris = Duration(milliseconds: 600);
  static const reward = Duration(milliseconds: 900);
  static const fragment = Duration(milliseconds: 500);
  static const enterCurve = Cubic(0.2, 0, 0, 1);
  static const leaveCurve = Cubic(0.3, 0, 1, 1);
  static const irisCurve = Cubic(0.05, 0.7, 0.1, 1);
}

/// Abstände und Größen in dp.
abstract final class Space {
  static const gutter = 20.0;
  static const gap = 12.0;
  static const safetyGap = 24.0;
  static const primary = 72.0;
  static const secondary = 64.0;
  static const tertiary = 56.0;
  static const radius = 12.0;
  static const safetyBar = 64.0;
}

/// Alles, was ein Bildschirm über Licht, Welt und Lesestufe wissen muss.
@immutable
class LykoraTokens extends ThemeExtension<LykoraTokens> {
  const LykoraTokens({required this.mode, required this.genre, required this.young});

  final LightMode mode;
  final Genre genre;

  /// Lesefassung für 6–9: größere Schrift, Fibelschrift für Geschichte und Aufgaben
  final bool young;

  Palette get p => paletteFor(mode, genre);
  GenreStyle get g => genreStyles[genre]!;

  /// Rotlicht und Bernstein: Zustände nur über Form, Helligkeit und Text
  bool get monochrome => mode == LightMode.red || mode == LightMode.amber;

  /// Rotlicht braucht größere, kräftigere Schrift, weil reines Rot nur 5,25:1 schafft.
  double get _boost => mode == LightMode.red ? 2 : 0;

  TextStyle get body => TextStyle(
    fontFamily: Fonts.ui,
    fontSize: (young ? 24 : 20) + _boost,
    height: 1.45,
    fontWeight: mode == LightMode.red ? FontWeight.w600 : FontWeight.w400,
    color: p.text,
  );

  /// Geschichte und Aufgaben: für 6–9 in der Fibelschrift
  TextStyle get story => body.copyWith(fontFamily: young ? Fonts.reader : Fonts.ui);

  /// Vorlesekarte für die Gruppe
  TextStyle get readAloud => story.copyWith(fontSize: (young ? 32 : 28) + _boost, height: 1.35);

  TextStyle get muted => body.copyWith(fontSize: (young ? 20 : 18) + _boost, color: p.textMuted);

  TextStyle get small => body.copyWith(fontSize: (young ? 18 : 16) + _boost, color: p.textMuted, height: 1.35);

  TextStyle get label =>
      TextStyle(fontFamily: Fonts.mono, fontSize: 15 + _boost, fontWeight: FontWeight.w700, letterSpacing: 1.6, color: p.textMuted, height: 1.2);

  TextStyle get button => TextStyle(fontFamily: Fonts.ui, fontSize: young ? 22 : 20, fontWeight: young ? FontWeight.w800 : FontWeight.w600, height: 1.1);

  TextStyle get heading => TextStyle(fontFamily: Fonts.ui, fontSize: (young ? 26 : 24) + _boost, fontWeight: FontWeight.w800, height: 1.2, color: p.text);

  TextStyle get number =>
      TextStyle(fontFamily: Fonts.mono, fontSize: 32, fontWeight: FontWeight.w700, color: p.text, fontFeatures: const [FontFeature.tabularFigures()]);

  /// Titel in der Schrift der Spielwelt
  TextStyle display(double size) => TextStyle(
    fontFamily: g.display,
    fontSize: size,
    fontWeight: g.displayWeight,
    height: 1.1,
    letterSpacing: g.displayUpper ? size * 0.04 : 0,
    color: p.text,
  );

  String displayText(String s) => g.displayUpper ? s.toUpperCase() : s;

  @override
  LykoraTokens copyWith({LightMode? mode, Genre? genre, bool? young}) =>
      LykoraTokens(mode: mode ?? this.mode, genre: genre ?? this.genre, young: young ?? this.young);

  @override
  LykoraTokens lerp(ThemeExtension<LykoraTokens>? other, double t) => t < 0.5 || other is! LykoraTokens ? this : other;
}

extension TokensContext on BuildContext {
  LykoraTokens get tok => Theme.of(this).extension<LykoraTokens>()!;
}

/// Material-Theme aus den Tokens: Grundlage für Standard-Widgets wie Dialoge und Eingabefelder.
ThemeData buildTheme(LykoraTokens t) {
  final p = t.p;
  final scheme = ColorScheme(
    brightness: p.brightness,
    primary: p.accent,
    onPrimary: p.onAccent,
    secondary: p.accent,
    onSecondary: p.onAccent,
    error: p.safety,
    onError: p.onSafety,
    surface: p.surface,
    onSurface: p.text,
    surfaceContainerHighest: p.raised,
    onSurfaceVariant: p.textMuted,
    outline: p.edge,
    outlineVariant: p.line,
  );
  final base = ThemeData(colorScheme: scheme, useMaterial3: true, fontFamily: Fonts.ui, brightness: p.brightness);
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Space.radius));
  return base.copyWith(
    scaffoldBackgroundColor: p.ground,
    canvasColor: p.ground,
    splashFactory: NoSplash.splashFactory,
    textTheme: base.textTheme.apply(fontFamily: Fonts.ui, bodyColor: p.text, displayColor: p.text),
    extensions: [t],
    appBarTheme: AppBarTheme(
      backgroundColor: p.ground,
      foregroundColor: p.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: t.heading.copyWith(fontSize: 20),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, Space.primary),
        backgroundColor: p.accent,
        foregroundColor: p.onAccent,
        textStyle: t.button,
        shape: shape,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(64, Space.secondary),
        foregroundColor: p.text,
        side: BorderSide(color: p.accent, width: 2),
        textStyle: t.button,
        shape: shape,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(minimumSize: const Size(56, Space.tertiary), foregroundColor: p.accent, textStyle: t.button.copyWith(fontSize: 18)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.raised,
      labelStyle: t.muted,
      hintStyle: t.muted,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Space.radius),
        borderSide: BorderSide(color: p.edge),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Space.radius),
        borderSide: BorderSide(color: p.edge),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Space.radius),
        borderSide: BorderSide(color: p.accent, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
    ),
    dialogTheme: DialogThemeData(backgroundColor: p.surface, shape: shape, titleTextStyle: t.heading, contentTextStyle: t.body),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: p.raised,
      contentTextStyle: t.body.copyWith(fontSize: 18),
      behavior: SnackBarBehavior.floating,
      shape: shape,
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? p.accent : Colors.transparent),
      checkColor: WidgetStatePropertyAll(p.onAccent),
      side: BorderSide(color: p.edge, width: 2),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.accent),
    dividerTheme: DividerThemeData(color: p.line, thickness: 1),
  );
}
