// Klang und Vibration der App.
//
// Höchstens vier Vibrationsmuster, damit sie unterscheidbar bleiben: Tick, Puls, Ankunft und
// Sicherheit. Muster und Ton „Sicherheit“ sind reserviert und kommen in der Geschichte nie vor.
// Plugins fehlen in Widget-Tests; alle Aufrufe schlucken deshalb Fehler und lassen sich abschalten.

import 'dart:async';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/services.dart';
import 'package:vibration/vibration.dart';

enum Sound { click, tick, squelchOn, squelchOff, pulse, arrival, solved, seal, rattle, key, chapter, safety }

extension on Sound {
  String get file => switch (this) {
    Sound.squelchOn => 'squelch_on',
    Sound.squelchOff => 'squelch_off',
    _ => name,
  };
}

enum Buzz {
  /// 10 ms leicht: Zahlenrad, Auswahl
  tick,

  /// 40 ms: Annäherung
  pulse,

  /// 80–60–80 ms: Station geweckt, gelöst
  arrival,

  /// 600–300–600–300–600 ms, volle Stärke: SOS, Rückruf, Sperrzone, Lebenszeichen
  safety,
}

class Fx {
  Fx._();
  static final instance = Fx._();

  /// In Widget-Tests aus, weil dort keine Plugins laufen.
  static bool enabled = !Platform.environment.containsKey('FLUTTER_TEST');

  bool sound = true;
  bool vibration = true;

  final _ui = <AudioPlayer>[];
  int _next = 0;
  AudioPlayer? _story;
  AudioPlayer? _safety;
  bool _safetyActive = false;

  /// Läuft gerade eine Sicherheitsdurchsage, schweigt die Geschichte.
  bool get safetyActive => _safetyActive;

  AudioPlayer _uiPlayer() {
    if (_ui.length < 3) {
      final p = AudioPlayer()..setPlayerMode(PlayerMode.lowLatency);
      _ui.add(p);
      return p;
    }
    return _ui[_next++ % _ui.length];
  }

  Future<void> play(Sound s, {double volume = 0.8}) async {
    if (!enabled || !sound || (_safetyActive && s != Sound.safety)) return;
    try {
      await _uiPlayer().play(AssetSource('sounds/${s.file}.wav'), volume: volume);
    } catch (_) {}
  }

  Future<void> buzz(Buzz b) async {
    if (!enabled) return;
    if (!vibration && b != Buzz.safety) return;
    try {
      switch (b) {
        case Buzz.tick:
          await HapticFeedback.selectionClick();
        case Buzz.pulse:
          await Vibration.vibrate(duration: 40, amplitude: 160);
        case Buzz.arrival:
          await Vibration.vibrate(pattern: const [0, 80, 60, 80], intensities: const [0, 200, 0, 200]);
        case Buzz.safety:
          await Vibration.vibrate(pattern: const [0, 600, 300, 600, 300, 600], intensities: const [0, 255, 0, 255, 0, 255]);
      }
    } catch (_) {}
  }

  /// Hörstück der Geschichte aus dem Spielpaket. Ersetzt ein laufendes.
  Future<void> playStory(File file, {void Function()? onDone}) async {
    if (!enabled || _safetyActive) return;
    try {
      final p = _story ??= AudioPlayer();
      await p.stop();
      if (onDone != null) unawaited(p.onPlayerComplete.first.then((_) => onDone()));
      await p.play(DeviceFileSource(file.path));
    } catch (_) {}
  }

  Future<void> stopStory() async {
    try {
      await _story?.stop();
    } catch (_) {}
  }

  /// Sicherheitsfall: Geschichte sofort still, reservierter Zweiklang und Vibration.
  Future<void> safetyAlarm() async {
    _safetyActive = true;
    await stopStory();
    if (!enabled) return;
    try {
      final p = _safety ??= AudioPlayer();
      await p.play(AssetSource('sounds/${Sound.safety.file}.wav'), volume: 1);
    } catch (_) {}
    await buzz(Buzz.safety);
  }

  void safetyCleared() => _safetyActive = false;
}
