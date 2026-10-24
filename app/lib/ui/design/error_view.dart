// Fehlerseite im Ton der App statt des roten oder grauen Fehlerbildschirms.
//
// Ein Fehler beim Aufbau ersetzt nur das betroffene Stück Oberfläche. Die Sicherheitsleiste mit SOS liegt
// über allen Seiten und bleibt dadurch bedienbar.

import 'dart:collection';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'tokens.dart';

/// Die letzten Fehler im Speicher, damit sich ein Absturz im Nachhinein einordnen lässt.
/// Bewusst nur im Arbeitsspeicher: Stapelspuren verlassen das Gerät nicht.
abstract final class ErrorLog {
  static const capacity = 20;
  static final _entries = Queue<String>();

  static List<String> get entries => List.unmodifiable(_entries);

  static void add(Object error, StackTrace? stack) {
    final text = '${DateTime.now().toIso8601String()} $error${stack == null ? '' : '\n$stack'}';
    _entries.addLast(text);
    while (_entries.length > capacity) {
      _entries.removeFirst();
    }
    debugPrint(text);
  }

  static void clear() => _entries.clear();
}

/// Meldet Fehler in den Speicher und ersetzt kaputte Oberfläche durch [LykoraErrorView].
/// Beides gilt für die ganze App; Aufruf einmal in `main`.
void installErrorHandling() {
  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    ErrorLog.add(details.exception, details.stack);
    if (previous != null) {
      previous(details);
    } else {
      FlutterError.presentError(details);
    }
  };
  // Fehler außerhalb des Frames (Futures, Streams): protokollieren, die App läuft weiter.
  ui.PlatformDispatcher.instance.onError = (error, stack) {
    ErrorLog.add(error, stack);
    return true;
  };
  ErrorWidget.builder = (details) => LykoraErrorView(details: details);
}

/// Freundliche Ersatzfläche für ein Widget, dessen Aufbau fehlgeschlagen ist.
class LykoraErrorView extends StatelessWidget {
  const LykoraErrorView({super.key, this.details});
  final FlutterErrorDetails? details;

  /// Aktueller Lichtmodus; die Fehlerseite hat keinen Theme-Zugriff und darf nachts nie hell aufblitzen.
  static LightMode mode = LightMode.night;

  @override
  Widget build(BuildContext context) {
    final p = paletteFor(mode, Genre.other);
    final style = TextStyle(fontFamily: Fonts.ui, fontSize: 18, height: 1.4, color: p.text, decoration: TextDecoration.none, fontWeight: FontWeight.w400);
    return Directionality(
      textDirection: TextDirection.ltr,
      child: ColoredBox(
        color: p.ground,
        // Passt sich jedem Platz an, den der Elternteil lässt, und läuft nie über.
        child: Center(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 340),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(
                      liveRegion: true,
                      child: Text('Das Signal ist abgerissen.', style: style.copyWith(fontSize: 24, fontWeight: FontWeight.w800, height: 1.2)),
                    ),
                    const SizedBox(height: 10),
                    Text('Hier ist etwas schiefgegangen. Geht einen Schritt zurück oder startet die App neu. Euer Spielstand bleibt erhalten.', style: style),
                    const SizedBox(height: 10),
                    Text('Im Notfall: 112 anrufen.', style: style.copyWith(fontWeight: FontWeight.w700)),
                    if (kDebugMode && details != null) ...[
                      const SizedBox(height: 10),
                      Text(details!.exceptionAsString(), style: style.copyWith(fontSize: 12, color: p.textMuted), maxLines: 4, overflow: TextOverflow.ellipsis),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
