import 'package:flutter/material.dart';

/// Laternen-Orange als Leitfarbe, dunkel als Standard für Nachtspiele.
const lantern = Color(0xFFF2A33A);
const sosRed = Color(0xFFD32F2F);
const okGreen = Color(0xFF43A047);

ThemeData lykoraTheme(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(seedColor: lantern, brightness: brightness, primary: lantern);
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    scaffoldBackgroundColor: brightness == Brightness.dark ? const Color(0xFF0E0F12) : null,
    visualDensity: VisualDensity.comfortable,
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: const Size(64, 52), textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size(64, 48))),
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
    cardTheme: const CardThemeData(margin: EdgeInsets.symmetric(vertical: 6)),
  );
}

/// Bildet jede Farbe auf ihre Helligkeit im Rotkanal ab.
const redLightFilter = ColorFilter.matrix(<double>[
  0.30, 0.59, 0.11, 0, 0, //
  0, 0, 0, 0, 0, //
  0, 0, 0, 0, 0, //
  0, 0, 0, 1, 0, //
]);
